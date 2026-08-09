<script lang="ts">
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import BookmarkPlusIcon from '@lucide/svelte/icons/bookmark-plus';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ServerIcon from '@lucide/svelte/icons/server';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { mode } from 'mode-watcher';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	import AppHeader from '$lib/components/app/app-header.svelte';
	import AppShell from '$lib/components/app/app-shell.svelte';
	import ClusterConnectionSelector from '$lib/components/cluster/cluster-connection-selector.svelte';
	import ConnectionFailureDialog from '$lib/components/cluster/connection-failure-dialog.svelte';
	import ExplorerHero from '$lib/components/explorer/explorer-hero.svelte';
	import ConnectionStatus from '$lib/components/query/connection-status.svelte';
	import DatabaseExplorer from '$lib/components/query/database-explorer.svelte';
	import type {
		ExplorerQuery,
		ExplorerSelection
	} from '$lib/components/query/database-explorer/cluster-explorer-types';
	import DatabaseSchema from '$lib/components/cluster/database-schema.svelte';
	import MonacoEditor, { type EditorDiagnostic } from '$lib/components/query/monaco-editor.svelte';
	import QueryResults from '$lib/components/query/query-results.svelte';
	import SavedQueriesPage from '$lib/components/query/saved-queries-page.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Resizable from '$lib/components/ui/resizable';
	import { Spinner } from '$lib/components/ui/spinner';
	import { deletePersistentDuckDbStorage } from '$lib/duckdb/storage';
	import { startEmulatedQuery } from '$lib/emulation/cluster';
	import { LogAnalyticsQueryRequestError, startLogAnalyticsQuery } from '$lib/log-analytics/client';
	import { getClusterSession } from '$lib/cluster/cluster-session.svelte';
	import { connectClusterRuntime, releaseClusterRuntime } from '$lib/cluster/cluster-runtime';
	import {
		getPersistedActiveClusterId,
		persistActiveClusterId
	} from '$lib/cluster/active-cluster-preference';
	import {
		getClusterConnectionStore,
		type NewClusterConnection
	} from '$lib/cluster/cluster-connection-store.svelte';
	import { usesBuiltInMockCatalog } from '$lib/cluster/mock-cluster-schema';
	import { MOCK_RECENT_QUERIES, MOCK_SAVED_QUERIES } from '$lib/data/mock-queries';
	import { getKustoErrorMessage, startKustoQuery } from '$lib/kusto/query-client';
	import { disposeKqlTranslator } from '$lib/kql/wasm-translator';
	import { getRecentQueryStore } from '$lib/query/recent-query-store.svelte';
	import { getSavedQueryStore } from '$lib/query/saved-query-store.svelte';
	import type { KustoDatabase, KustoDatabaseSchema } from '$lib/types/kusto-schema';
	import type { QueryExecution, QueryResult } from '$lib/types/query-result';
	import type { PaneAPI } from 'paneforge';

	type ConnectionState = 'loading' | 'ready' | 'error';
	type QueryWorkspaceView = 'overview' | 'editor' | 'saved-queries';

	type QueryWorkspaceProps = {
		view?: QueryWorkspaceView;
	};

	let { view = 'editor' }: QueryWorkspaceProps = $props();
	const clusterConnectionStore = getClusterConnectionStore();
	const initialClusters = clusterConnectionStore.clusters;
	const clusters = $derived(clusterConnectionStore.clusters);
	const customClusters = $derived(clusterConnectionStore.customClusters);
	const clusterSession = getClusterSession();
	const recentQueryStore = getRecentQueryStore();
	const savedQueryStore = getSavedQueryStore();
	const initialCluster =
		initialClusters.find((cluster) => cluster.id === clusterSession.activeClusterId) ??
		initialClusters[0];

	// Schema metadata crosses the Monaco worker boundary and must remain structured-cloneable.
	// `$state.raw` keeps the SDK-derived arrays and objects from becoming Svelte proxies.
	let databaseSchema = $state.raw<KustoDatabaseSchema | undefined>(clusterSession.databaseSchema);
	let connectionStatus = $state<ConnectionState>('loading');
	let isClusterSwitching = $state(false);
	let connectionError = $state('');
	let failedClusterId = $state<string>();
	let explorerFilter = $state('');
	let selectedDatabase = $state(clusterSession.selectedDatabase);
	let selectedTable = $state(clusterSession.selectedTable);
	let selectedFunction = $state(clusterSession.selectedFunction);
	let queryText = $state('');
	let queryResult = $state<QueryResult>();
	let queryError = $state('');
	let queryErrorRequestId = $state<string>();
	let queryErrorRaw = $state<unknown>();
	let resultsCollapsed = $state(false);
	let resultsPane = $state<PaneAPI>();
	let isQueryRunning = $state(false);
	let activeExecution: QueryExecution | undefined;
	let editorComponent = $state<{ getDiagnostics: () => EditorDiagnostic[] }>();
	let schemaRequestId = 0;
	let queryRequestId = 0;

	let activeClusterId = $state(initialCluster.id);
	let activeClusterUrl = $state(initialCluster.url);
	let selectedClusterId = $state(initialCluster.id);
	const hasCluster = $derived(Boolean(databaseSchema));
	const activeCluster = $derived(clusters.find((cluster) => cluster.id === activeClusterId));
	const isMockCluster = $derived(activeCluster?.kind === 'mock');
	const isEmulatedCluster = $derived(activeCluster?.kind === 'emulated');
	const isLogAnalyticsCluster = $derived(activeCluster?.kind === 'log-analytics');
	const hasBuiltInMockSamples = $derived(usesBuiltInMockCatalog(activeCluster));
	let explorerExpansion = $state(clusterSession.getExplorerExpansion(initialCluster.id));
	const isQueryable = $derived(hasCluster && !isMockCluster);
	const canSaveQuery = $derived(Boolean(queryText.trim() && selectedDatabase));
	const selectedClusterName = $derived(
		clusters.find((cluster) => cluster.id === selectedClusterId)?.name ?? 'selected cluster'
	);
	const activeClusterName = $derived(
		clusters.find((cluster) => cluster.id === activeClusterId)?.name ?? 'current cluster'
	);
	const failedClusterName = $derived(
		clusters.find((cluster) => cluster.id === failedClusterId)?.name ?? 'selected cluster'
	);
	const connectionStatistics = $derived.by(() => {
		const databases = Object.values(databaseSchema ?? {});
		return {
			databaseCount: databases.length,
			tableCount: databases.reduce((count, database) => count + database.tables.length, 0),
			functionCount: databases.reduce(
				(count, database) => count + (database.functions?.length ?? 0),
				0
			)
		};
	});
	const editorTheme = $derived(mode.current === 'dark' ? 'vs-dark' : 'vs');
	const storedRecentQueries = $derived<ExplorerQuery[]>(
		recentQueryStore.forCluster(activeClusterId)
	);
	const recentQueries = $derived<ExplorerQuery[]>(
		storedRecentQueries.length
			? storedRecentQueries
			: hasBuiltInMockSamples
				? MOCK_RECENT_QUERIES
				: []
	);
	const savedQueries = $derived<ExplorerQuery[]>([
		...(hasBuiltInMockSamples ? MOCK_SAVED_QUERIES : []),
		...savedQueryStore.forCluster(activeClusterId)
	]);

	$effect(() => {
		clusterSession.selectedDatabase = selectedDatabase;
		clusterSession.selectedTable = selectedTable;
		clusterSession.selectedFunction = selectedFunction;
	});

	// Schema mutations can be made from the Admin workspace while this editor is
	// mounted. Keep the local snapshot (and therefore Monaco's schema prop) in
	// sync with the app-wide session so completion never uses stale table metadata.
	$effect(() => {
		const sessionSchema = clusterSession.databaseSchema;
		if (databaseSchema !== sessionSchema) databaseSchema = sessionSchema;
	});

	$effect(() => {
		explorerExpansion = clusterSession.getExplorerExpansion(activeClusterId);
	});

	$effect(() => {
		if (!isEmulatedCluster) disposeKqlTranslator();
	});

	function quoteEntity(name: string) {
		return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `['${name.replaceAll("'", "''")}']`;
	}

	function createDefaultQuery(database: KustoDatabase) {
		const preferredTable =
			database.tables.find((table) => table.name.toLowerCase() === 'metrics') ?? database.tables[0];
		return preferredTable
			? `${quoteEntity(preferredTable.name)}\n| getschema`
			: 'print Message = "Connected"';
	}

	async function refreshSchema() {
		const requestId = ++schemaRequestId;
		const requestedCluster = clusterConnectionStore.clusters.find(
			(cluster) => cluster.id === selectedClusterId
		);
		if (!requestedCluster) return;
		const requestedClusterId = requestedCluster.id;
		const requestedClusterUrl = requestedCluster.url;
		const isChangingCluster = requestedClusterId !== activeClusterId;
		connectionStatus = 'loading';
		isClusterSwitching = isChangingCluster && Boolean(databaseSchema);
		connectionError = '';

		try {
			const schema = await connectClusterRuntime(requestedCluster);
			if (requestId !== schemaRequestId || requestedClusterId !== selectedClusterId) return;

			const firstDatabase = Object.values(schema)[0];
			const shouldRestoreSelection = requestedClusterId === clusterSession.activeClusterId;
			const restoredDatabase = shouldRestoreSelection ? schema[selectedDatabase] : undefined;
			const activeDatabase = restoredDatabase ?? firstDatabase;
			const restoredTable = activeDatabase.tables.some((table) => table.name === selectedTable)
				? selectedTable
				: undefined;
			const restoredFunction = activeDatabase.functions?.some((fn) => fn.name === selectedFunction)
				? selectedFunction
				: undefined;
			const pendingQuery = shouldRestoreSelection ? clusterSession.pendingQuery : undefined;
			clusterSession.getExplorerExpansion(requestedClusterId);
			activeClusterId = requestedClusterId;
			activeClusterUrl = requestedClusterUrl;
			clusterSession.activeClusterId = requestedClusterId;
			persistActiveClusterId(requestedClusterId);
			databaseSchema = schema;
			clusterSession.databaseSchema = schema;
			selectedDatabase = activeDatabase.name;
			selectedTable = restoredTable;
			selectedFunction = restoredFunction;
			queryText = pendingQuery ?? createDefaultQuery(activeDatabase);
			clusterSession.pendingQuery = undefined;
			queryResult = undefined;
			queryError = '';
			connectionStatus = 'ready';
			isClusterSwitching = false;
			failedClusterId = undefined;
		} catch (error) {
			if (requestId !== schemaRequestId) return;
			connectionError = getKustoErrorMessage(error);
			failedClusterId = requestedClusterId;
			isClusterSwitching = false;
			if (databaseSchema) {
				selectedClusterId = activeClusterId;
				connectionStatus = 'error';
			} else {
				connectionStatus = 'error';
			}
		}
	}

	function switchCluster(clusterId: string) {
		if (clusterId === selectedClusterId) return;

		queryRequestId += 1;
		activeExecution?.cancel();
		activeExecution = undefined;
		isQueryRunning = false;
		selectedClusterId = clusterId;
		void refreshSchema();
	}

	function addCluster(draft: NewClusterConnection) {
		const cluster = clusterConnectionStore.add(draft);
		switchCluster(cluster.id);
	}

	function editCluster(clusterId: string, draft: NewClusterConnection) {
		clusterConnectionStore.update(clusterId, draft);
		if (clusterId !== selectedClusterId) return;

		queryRequestId += 1;
		activeExecution?.cancel();
		activeExecution = undefined;
		isQueryRunning = false;
		void refreshSchema();
	}

	async function removeCluster(clusterId: string) {
		const wasSelected = clusterId === selectedClusterId || clusterId === activeClusterId;
		const removedCluster = clusters.find((cluster) => cluster.id === clusterId);
		if (removedCluster?.kind === 'emulated') {
			await releaseClusterRuntime(clusterId);
			if (removedCluster.emulatedStorage?.mode === 'opfs') {
				await deletePersistentDuckDbStorage(removedCluster.emulatedStorage.storageId);
			}
		}
		clusterConnectionStore.remove(clusterId);
		if (wasSelected) switchCluster(clusters[0].id);
	}

	function retryFailedCluster() {
		if (!failedClusterId) return;
		selectedClusterId = failedClusterId;
		void refreshSchema();
	}

	function dismissConnectionFailure() {
		connectionStatus = 'ready';
		connectionError = '';
		failedClusterId = undefined;
	}

	function loadRecentQuery(query: ExplorerQuery) {
		selectedDatabase = query.database;
		selectedTable = undefined;
		selectedFunction = undefined;
		queryText = query.query;
	}

	function openQuery(query: ExplorerQuery) {
		if (view === 'editor') {
			loadRecentQuery(query);
			return;
		}

		clusterSession.selectedDatabase = query.database;
		clusterSession.selectedTable = undefined;
		clusterSession.selectedFunction = undefined;
		clusterSession.pendingQuery = query.query;
		void goto('/explorer/query');
	}

	function openExplorerSelection(selection: ExplorerSelection) {
		if (view !== 'overview') return;
		clusterSession.selectedDatabase = selection.database;
		clusterSession.selectedTable = selection.table;
		clusterSession.selectedFunction = selection.function;
		void goto('/explorer/query');
	}

	function deleteSavedQuery(query: ExplorerQuery) {
		if (query.id) savedQueryStore.remove(query.id);
	}

	function deleteRecentQuery(query: ExplorerQuery) {
		if (query.id) recentQueryStore.remove(query.id);
	}

	function updateExplorerExpansion(
		change: import('$lib/cluster/cluster-session.svelte').ExplorerExpansionChange
	) {
		clusterSession.setExplorerExpansion(activeClusterId, change);
	}

	function saveCurrentQuery() {
		const query = queryText.trim();
		if (!query || !selectedDatabase) return;

		const name = window.prompt('Name this saved query');
		if (!name?.trim()) return;

		savedQueryStore.save({
			clusterId: activeClusterId,
			database: selectedDatabase,
			name,
			query
		});
	}

	function getRecentQueryName(query: string) {
		const firstLine = query.split('\n').find((line) => line.trim());
		return firstLine?.trim().replaceAll(/\s+/g, ' ').slice(0, 48) || 'Query';
	}

	function formatQueryFailure(serverMessage: string) {
		const diagnostics = editorComponent?.getDiagnostics() ?? [];
		const actionableDiagnostics = diagnostics.filter(
			(diagnostic) => diagnostic.severity === 'error' || diagnostic.severity === 'warning'
		);
		if (!actionableDiagnostics.length) return serverMessage;

		const diagnosticLines = actionableDiagnostics.map((diagnostic) => {
			const code = diagnostic.code ? ` [${diagnostic.code}]` : '';
			return `Line ${diagnostic.line}, column ${diagnostic.column}${code}: ${diagnostic.message}`;
		});
		return `${serverMessage}\n\nEditor diagnostics:\n${diagnosticLines.join('\n')}`;
	}

	async function runQuery() {
		const query = queryText.trim();
		if (!query || !selectedDatabase || isQueryRunning || isMockCluster) return;

		const requestId = ++queryRequestId;
		queryError = '';
		queryErrorRequestId = undefined;
		queryErrorRaw = undefined;
		resultsCollapsed = false;
		isQueryRunning = true;
		activeExecution = isEmulatedCluster
			? startEmulatedQuery(activeClusterId, selectedDatabase, query)
			: isLogAnalyticsCluster && activeCluster?.logAnalytics
				? startLogAnalyticsQuery(activeCluster.logAnalytics, query)
				: startKustoQuery(selectedDatabase, query, activeClusterUrl);
		recentQueryStore.record({
			clusterId: activeClusterId,
			database: selectedDatabase,
			name: getRecentQueryName(query),
			query
		});

		try {
			const result = await activeExecution.promise;
			if (requestId === queryRequestId) queryResult = result;
		} catch (error) {
			if (requestId === queryRequestId) {
				queryResult = undefined;
				queryError = formatQueryFailure(getKustoErrorMessage(error));
				if (error instanceof LogAnalyticsQueryRequestError) {
					queryErrorRequestId = error.requestId;
					queryErrorRaw = error.response;
				}
			}
		} finally {
			if (requestId === queryRequestId) {
				activeExecution = undefined;
				isQueryRunning = false;
			}
		}
	}

	function cancelQuery() {
		activeExecution?.cancel();
	}

	function setResultsCollapsed(collapsed: boolean) {
		resultsCollapsed = collapsed;
		if (collapsed) {
			resultsPane?.collapse();
		} else {
			resultsPane?.expand();
		}
	}

	onMount(() => {
		clusterConnectionStore.hydrate();
		const persistedClusterId = getPersistedActiveClusterId();
		if (
			!clusterSession.databaseSchema &&
			persistedClusterId &&
			clusters.some((cluster) => cluster.id === persistedClusterId)
		) {
			selectedClusterId = persistedClusterId;
		}
		void refreshSchema();
		return () => {
			schemaRequestId += 1;
			queryRequestId += 1;
			activeExecution?.cancel();
			disposeKqlTranslator();
		};
	});
</script>

<svelte:head>
	<title>Kite</title>
</svelte:head>

{#snippet sidebarHeader()}
	<ClusterConnectionSelector
		{clusters}
		{customClusters}
		{selectedClusterId}
		disabled={isClusterSwitching}
		onclusterchange={switchCluster}
		onclusteradd={addCluster}
		onclusteredit={editCluster}
		onclusterremove={removeCluster}
		onlinkauthenticationprofile={(clusterId, authenticationProfileId) => {
			clusterConnectionStore.linkLogAnalyticsAuthenticationProfile(clusterId, authenticationProfileId);
			switchCluster(clusterId);
		}}
	/>
{/snippet}

{#snippet sidebarContent()}
	<DatabaseExplorer
		databases={databaseSchema ?? {}}
		{connectionStatus}
		showCluster={hasCluster}
		clusterDisabled={isClusterSwitching}
		bind:selectedDatabase
		bind:selectedTable
		bind:selectedFunction
		expansionState={explorerExpansion}
		onexpansionchange={updateExplorerExpansion}
		{recentQueries}
		{savedQueries}
		bind:filter={explorerFilter}
		onqueryselect={openQuery}
		onselectionchange={view === 'overview' ? openExplorerSelection : undefined}
		onsavedquerydelete={deleteSavedQuery}
		onrecentquerydelete={deleteRecentQuery}
	/>
{/snippet}

<AppShell {sidebarHeader} {sidebarContent}>
	<AppHeader
		breadcrumbs={view === 'overview'
			? [{ label: 'Kite', href: '/' }, { label: 'Explorer' }]
			: view === 'editor'
				? [
						{ label: 'Kite', href: '/' },
						{ label: 'Explorer', href: '/explorer' },
						{ label: 'Query' }
					]
				: [
						{ label: 'Kite', href: '/' },
						{ label: 'Explorer', href: '/explorer' },
						{ label: 'Query', href: '/explorer/query' },
						{ label: 'Saved queries' }
					]}
		title={view === 'overview' ? '' : view === 'editor' ? 'Kite KQL Editor' : 'Saved queries'}
		badge={view === 'editor' ? 'Alpha' : undefined}
		sidebarToggleLabel="Toggle cluster explorer"
	>
		{#if view === 'editor'}
			<p class="text-muted-foreground mt-1 text-sm">
				Query, explore, and inspect the connected Kusto cluster. For setting up local Kusto cluster,
				see <a
					href="https://github.com/Jiayang-Lai/100-Days-of-KQL#2026-04-19-update"
					target="_blank"
					class="text-primary underline hover:text-primary/80">author's guide</a
				>.
			</p>
		{:else if view === 'saved-queries'}
			<p class="text-muted-foreground mt-1 text-sm">Saved KQL quries for the current cluster.</p>
		{/if}
	</AppHeader>

	{#if view === 'overview'}
		<ExplorerHero
			clusterName={activeClusterName}
			databaseCount={connectionStatistics.databaseCount}
			tableCount={connectionStatistics.tableCount}
			emulatedStorage={activeCluster?.emulatedStorage}
		/>
	{:else if view === 'saved-queries'}
		<SavedQueriesPage queries={savedQueries} onopen={openQuery} delete={deleteSavedQuery} />
	{:else}
		{#if isEmulatedCluster}
			<div
				class="border-warning/40 bg-warning/10 text-warning flex shrink-0 items-start gap-2 rounded-lg border px-3 py-2 text-xs"
				role="alert"
			>
				<TriangleAlertIcon class="size-4 shrink-0" />
				<p>
					Results from the emulated cluster may differ from Kusto. Translation is limited to the
					operators and functions supported by
					<a
						href="https://github.com/Jiayang-Lai/kql-to-sql"
						target="_blank"
						rel="noreferrer"
						class="font-medium underline underline-offset-2 hover:text-warning/80">kql-to-sql</a
					>.
				</p>
			</div>
		{/if}

		<Resizable.PaneGroup
			direction="horizontal"
			autoSaveId="kite-cluster-layout"
			class="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background shadow-xs"
		>
			{#if databaseSchema}
				<Resizable.Pane defaultSize={75} minSize={45}>
					<div class="relative h-full min-h-0">
						<Resizable.PaneGroup
							direction="vertical"
							autoSaveId="kite-query-layout"
							class="min-h-0"
						>
							<Resizable.Pane defaultSize={66} minSize={25}>
								<div
									class="relative flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden bg-background p-2 sm:p-3"
									aria-busy={isClusterSwitching}
								>
									<div class="flex h-8 shrink-0 items-center justify-between gap-2">
										<div class="flex min-w-0 items-center gap-2">
											<ServerIcon class="text-muted-foreground size-4 shrink-0" />
											<span class="truncate text-xs font-medium">{selectedDatabase}</span>
										</div>

										<div class="flex shrink-0 items-center gap-2">
											<Button
												variant="outline"
												size="sm"
												disabled={!canSaveQuery}
												onclick={saveCurrentQuery}
												title="Save query locally"
											>
												<BookmarkPlusIcon />
												Save
											</Button>
											{#if isQueryRunning}
												<Button variant="outline" size="sm" onclick={cancelQuery}>
													<CircleStopIcon />
													Cancel
												</Button>
											{:else}
												<Button
													size="sm"
													onclick={() => void runQuery()}
													disabled={!queryText.trim() || isMockCluster}
													title={isMockCluster
														? 'Query execution is unavailable for the mock cluster'
									: 'Run query (Shift+Enter)'}
									aria-keyshortcuts={isMockCluster ? undefined : 'Shift+Enter'}
												>
													<PlayIcon />
													Run
												</Button>
											{/if}
										</div>
									</div>

									<MonacoEditor
										bind:this={editorComponent}
										bind:value={queryText}
										class="min-h-0 flex-1 border"
										database={selectedDatabase}
										height="100%"
										{databaseSchema}
										clusterUrl={activeClusterUrl}
										theme={editorTheme}
										onexecute={() => void runQuery()}
									/>

									{#if isClusterSwitching}
										<div
											class="absolute inset-0 z-20 grid place-items-center bg-background/70 backdrop-blur-[1px]"
										>
											<div
												class="text-muted-foreground flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs shadow-sm"
											>
												<Spinner class="size-4" />
												<span>Switching to {selectedClusterName}…</span>
											</div>
										</div>
									{/if}
								</div>
							</Resizable.Pane>

							<Resizable.Handle />

							<Resizable.Pane
								bind:this={resultsPane}
								defaultSize={34}
								minSize={5}
								collapsible
								collapsedSize={5}
								onCollapse={() => (resultsCollapsed = true)}
								onExpand={() => (resultsCollapsed = false)}
							>
								<QueryResults
									class="h-full min-h-0 rounded-none border-0"
									result={queryResult}
									error={queryError}
									errorRequestId={queryErrorRequestId}
									errorRaw={queryErrorRaw}
									isRunning={isQueryRunning}
									collapsed={resultsCollapsed}
									oncollapsedchange={setResultsCollapsed}
								/>
							</Resizable.Pane>
						</Resizable.PaneGroup>
					</div>
				</Resizable.Pane>

				<Resizable.Handle />

				<Resizable.Pane defaultSize={25} minSize={15} maxSize={40}>
					<DatabaseSchema
						class={isClusterSwitching
							? 'pointer-events-none h-full min-h-0 rounded-none border-0 opacity-60 shadow-none'
							: 'h-full min-h-0 rounded-none border-0 shadow-none'}
						database={databaseSchema[selectedDatabase]}
						expansionState={explorerExpansion}
						onexpansionchange={updateExplorerExpansion}
						bind:selectedTable
						bind:selectedFunction
						height="100%"
					/>
				</Resizable.Pane>
			{:else}
				<Resizable.Pane defaultSize={82} minSize={35}>
					<section
						class="flex h-full min-h-0 items-center justify-center bg-background p-6"
						aria-live="polite"
					>
						{#if connectionStatus === 'loading'}
							<div class="text-muted-foreground flex flex-col items-center gap-3 text-sm">
								<Spinner class="size-6" />
								<p>Connecting to the selected cluster…</p>
							</div>
						{:else}
							<div class="max-w-md text-center">
								<h2 class="font-semibold">Could not connect to Kusto</h2>
								<p class="text-muted-foreground mt-2 text-sm">{connectionError}</p>
								<Button class="mt-4" variant="outline" onclick={() => void refreshSchema()}>
									<RefreshCwIcon />
									Retry
								</Button>
							</div>
						{/if}
					</section>
				</Resizable.Pane>
			{/if}
		</Resizable.PaneGroup>

		<ConnectionStatus
			status={connectionStatus}
			{...connectionStatistics}
			{isQueryable}
			emulatedStorage={activeCluster?.emulatedStorage}
			onretry={failedClusterId ? retryFailedCluster : undefined}
		/>
	{/if}

	{#if connectionStatus === 'error' && connectionError && databaseSchema}
		<ConnectionFailureDialog
			{failedClusterName}
			{activeClusterName}
			error={connectionError}
			oncontinue={dismissConnectionFailure}
			onretry={retryFailedCluster}
		/>
	{/if}
</AppShell>
