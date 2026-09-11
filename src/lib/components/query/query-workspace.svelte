<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';

	import AppHeader from '$lib/components/app/app-header.svelte';
	import AppShell from '$lib/components/app/app-shell.svelte';
	import ClusterConnectionSelector from '$lib/components/cluster/cluster-connection-selector.svelte';
	import ConnectionFailureDialog from '$lib/components/cluster/connection-failure-dialog.svelte';
	import DatabaseExplorer from '$lib/components/query/database-explorer.svelte';
	import type {
		ExplorerQuery,
		ExplorerSelection
	} from '$lib/components/query/database-explorer/cluster-explorer-types';
	import SaveQueryDialog from '$lib/components/query/save-query-dialog.svelte';
	import type {
		LanguageServiceStatus,
		QueryWorkspaceExecutionState
	} from '$lib/components/query/query-workspace-types';
	import { Spinner } from '$lib/components/ui/spinner';
	import { getClusterSession } from '$lib/cluster/cluster-session.svelte';
	import type { QueryTab } from '$lib/cluster/cluster-session.svelte';
	import { createConnectionRuntime } from '$lib/cluster/cluster-runtime';
	import { getConnectionCapabilities } from '$lib/cluster/connection-capabilities';
	import { getPersistedActiveClusterId } from '$lib/cluster/active-cluster-preference';
	import {
		getClusterConnectionStore,
		type NewClusterConnection
	} from '$lib/cluster/cluster-connection-store.svelte';
	import { usesBuiltInMockCatalog } from '$lib/cluster/mock-cluster-schema';
	import { MOCK_RECENT_QUERIES, MOCK_SAVED_QUERIES } from '$lib/data/mock-queries';
	import { disposeKqlTranslator } from '$lib/kql/wasm-translator';
	import { getRecentQueryStore } from '$lib/query/recent-query-store.svelte';
	import { createSavedQueryWorkspaceController } from '$lib/query/saved-query-workspace-controller';
	import { createConnectionLifecycleController } from '$lib/query/connection-lifecycle-controller.svelte';
	import { createQueryExecutionController } from '$lib/query/query-execution-controller.svelte';
	import { createQueryTabController } from '$lib/query/query-tab-controller.svelte';
	import { getSavedQueryStore } from '$lib/query/saved-query-store.svelte';

	type QueryWorkspaceView = 'overview' | 'editor' | 'saved-queries';
	type ComparisonSide = 'left' | 'right';
	const LOG_ANALYTICS_SCHEMA_TTL_MS = 5 * 60_000;

	type QueryWorkspaceProps = {
		view?: QueryWorkspaceView;
	};

	let { view = 'editor' }: QueryWorkspaceProps = $props();
	const explorerHeroModule = $derived(
		view === 'overview' ? import('$lib/components/explorer/explorer-hero.svelte') : undefined
	);
	const savedQueriesPageModule = $derived(
		view === 'saved-queries' ? import('$lib/components/query/saved-queries-page.svelte') : undefined
	);
	const queryEditorWorkspaceModule = $derived(
		view === 'editor' ? import('$lib/components/query/query-editor-workspace.svelte') : undefined
	);
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

	let explorerFilter = $state('');
	let hasInitializedConnection = false;
	let selectedDatabase = $state(clusterSession.selectedDatabase);
	let selectedTable = $state(clusterSession.selectedTable);
	let selectedFunction = $state(clusterSession.selectedFunction);
	const executionState = $state<QueryWorkspaceExecutionState>({
		queryText: '',
		result: undefined,
		error: '',
		errorRequestId: undefined,
		errorRaw: undefined,
		isRunning: false,
		resultsCollapsed: false
	});
	let languageServiceStatus = $state<LanguageServiceStatus>('idle');
	const savedQueryState = $state({
		dialogOpen: false,
		name: '',
		nameError: '',
		pendingTabId: undefined as string | undefined
	});
	let editorWorkspace = $state<{
		getDiagnostics: () => import('./monaco-editor.svelte').EditorDiagnostic[];
	}>();
	const tabComparisonState = $state({
		comparisonOriginalTabId: undefined as string | undefined,
		comparisonModifiedTabId: undefined as string | undefined,
		focusedComparisonSide: 'right' as ComparisonSide
	});

	const queryTabs = $derived(clusterSession.queryTabs);
	const activeQueryTabId = $derived(clusterSession.activeQueryTabId);
	const activeQueryTab = $derived(clusterSession.getQueryTab(activeQueryTabId));
	const comparisonModifiedTab = $derived(
		tabComparisonState.comparisonModifiedTabId
			? queryTabs.find((tab) => tab.id === tabComparisonState.comparisonModifiedTabId)
			: activeQueryTab
	);
	const compareCandidates = $derived(
		comparisonModifiedTab
			? queryTabs.filter(
					(tab) =>
						tab.id !== comparisonModifiedTab.id &&
						tab.database.trim().toLowerCase() ===
							comparisonModifiedTab.database.trim().toLowerCase()
				)
			: []
	);
	const comparisonOriginalTab = $derived(
		tabComparisonState.comparisonOriginalTabId
			? compareCandidates.find((tab) => tab.id === tabComparisonState.comparisonOriginalTabId)
			: undefined
	);
	const saveTargetTab = $derived(
		savedQueryState.pendingTabId
			? queryTabs.find((tab) => tab.id === savedQueryState.pendingTabId)
			: comparisonOriginalTab && comparisonModifiedTab
				? tabComparisonState.focusedComparisonSide === 'left'
					? comparisonOriginalTab
					: comparisonModifiedTab
				: activeQueryTab
	);
	const saveTargetSavedQuery = $derived(
		saveTargetTab?.savedQueryId
			? savedQueryStore.queries.find((query) => query.id === saveTargetTab.savedQueryId)
			: undefined
	);
	const isSaveTargetSavedQueryDirty = $derived(
		Boolean(
			saveTargetTab &&
			saveTargetSavedQuery &&
			(saveTargetTab.database !== saveTargetSavedQuery.database ||
				saveTargetTab.query.trim() !== saveTargetSavedQuery.query)
		)
	);
	const activeCluster = $derived(
		clusters.find((cluster) => cluster.id === clusterSession.activeClusterId)
	);
	const activeRuntime = $derived(
		activeCluster ? createConnectionRuntime(activeCluster) : undefined
	);
	const activeCapabilities = $derived(
		activeRuntime?.capabilities ?? getConnectionCapabilities(undefined)
	);
	const isMockCluster = $derived(activeCluster?.kind === 'mock');
	const isEmulatedCluster = $derived(activeCluster?.kind === 'emulated');
	const isLogAnalyticsCluster = $derived(activeCluster?.kind === 'log-analytics');
	const hasBuiltInMockSamples = $derived(usesBuiltInMockCatalog(activeCluster));
	let explorerExpansion = $state(clusterSession.getExplorerExpansion(initialCluster.id));
	const queryExecution = createQueryExecutionController({
		state: executionState,
		recentQueries: recentQueryStore,
		getActiveTab: () => activeQueryTab,
		getActiveClusterId: () => clusterSession.activeClusterId,
		getSelectedDatabase: () => selectedDatabase,
		getRuntime: () => activeRuntime,
		canExecute: () => !isClusterSwitching && activeCapabilities.queryExecutor !== 'none',
		getDiagnostics: () => editorWorkspace?.getDiagnostics() ?? [],
		updateTab: (tabId, update) => clusterSession.updateQueryTab(tabId, update)
	});
	const connectionLifecycle = createConnectionLifecycleController({
		store: clusterConnectionStore,
		session: clusterSession,
		initialCluster,
		onQueryExecutionReset: () => queryExecution.reset(),
		onSchemaReady: (database, pendingQuery) => {
			const tab = activeQueryTab ?? clusterSession.createQueryTab(database);
			clusterSession.updateQueryTab(tab.id, {
				database,
				query: pendingQuery ?? tab.query
			});
			loadQueryTab(clusterSession.getQueryTab(tab.id) ?? tab);
			executionState.result = undefined;
			executionState.error = '';
		},
		onstatechange: () => syncConnectionSelection()
	});
	// The lifecycle controller is the sole owner of connection transition state.
	// Schema remains raw in ClusterSession so it can safely cross the Monaco worker boundary.
	const databaseSchema = $derived(clusterSession.databaseSchema);
	const connectionStatus = $derived(connectionLifecycle.state.connectionStatus);
	const isClusterSwitching = $derived(connectionLifecycle.state.isClusterSwitching);
	const showLogAnalyticsSignInTip = $derived(connectionLifecycle.state.showLogAnalyticsSignInTip);
	const connectionError = $derived(connectionLifecycle.state.connectionError);
	const failedClusterId = $derived(connectionLifecycle.state.failedClusterId);
	const activeClusterId = $derived(connectionLifecycle.state.activeClusterId);
	const activeClusterUrl = $derived(connectionLifecycle.state.activeClusterUrl);
	const selectedClusterId = $derived(connectionLifecycle.state.selectedClusterId);
	const hasCluster = $derived(Boolean(databaseSchema));
	const isQueryable = $derived(
		!isClusterSwitching && hasCluster && activeCapabilities.queryExecutor !== 'none'
	);
	const isSelectedLogAnalyticsCluster = $derived(
		clusters.find((cluster) => cluster.id === selectedClusterId)?.kind === 'log-analytics'
	);
	const queryTabsController = createQueryTabController({
		state: tabComparisonState,
		session: clusterSession,
		savedQueries: savedQueryStore,
		getSelectedDatabase: () => selectedDatabase,
		setSelectedDatabase: (database) => (selectedDatabase = database),
		clearSchemaSelection: () => {
			selectedTable = undefined;
			selectedFunction = undefined;
		},
		onTabLoaded: (tab) => loadQueryTab(tab),
		onTabClosing: (tabId) => queryExecution.cancelTab(tabId)
	});
	const savedQueryController = createSavedQueryWorkspaceController({
		state: savedQueryState,
		session: clusterSession,
		savedQueries: savedQueryStore,
		getActiveClusterId: () => activeClusterId,
		getActiveTabId: () => activeQueryTabId,
		getTabs: () => queryTabs,
		loadTab: (tab) => loadQueryTab(tab),
		createTab: (database, query, savedQuery) =>
			queryTabsController.create(database, query, savedQuery),
		setExecutionQuery: (query) => (executionState.queryText = query),
		navigateToEditor: () => void goto('/explorer/query')
	});
	const canSaveTargetQuery = $derived(
		Boolean(saveTargetTab?.query.trim() && saveTargetTab.database)
	);
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

	$effect(() => {
		if (view !== 'editor' || !activeQueryTab) return;
		// QueryWorkspace is recreated when navigating from the saved-query list to the
		// editor. The tabs live in the app-wide session, while executionState belongs
		// to this workspace instance, so hydrate it from the selected shared tab.
		// Without this, a cached schema skips onSchemaReady and Monaco receives an
		// empty value even though the tab itself contains the saved query.
		queryExecution.loadTab(activeQueryTab);
	});

	$effect(() => {
		const tab = activeQueryTab;
		if (tab && tab.database !== selectedDatabase) {
			clusterSession.updateQueryTab(tab.id, { database: selectedDatabase });
		}
	});

	$effect(() => {
		if (
			tabComparisonState.comparisonOriginalTabId &&
			(!comparisonOriginalTab ||
				!tabComparisonState.comparisonModifiedTabId ||
				!comparisonModifiedTab)
		) {
			queryTabsController.stopComparison();
		}
	});

	$effect(() => {
		if (!savedQueryState.dialogOpen) savedQueryState.pendingTabId = undefined;
	});

	// Schema mutations can be made from the Admin workspace while this editor is
	// mounted. Keep the local snapshot (and therefore Monaco's schema prop) in
	// sync with the app-wide session so completion never uses stale table metadata.
	$effect(() => {
		explorerExpansion = clusterSession.getExplorerExpansion(activeClusterId);
	});

	$effect(() => {
		if (!isEmulatedCluster) disposeKqlTranslator();
	});

	function loadQueryTab(tab: QueryTab) {
		clusterSession.activeQueryTabId = tab.id;
		if (tab.database && databaseSchema?.[tab.database]) selectedDatabase = tab.database;
		selectedTable = undefined;
		selectedFunction = undefined;
		queryExecution.loadTab(tab);
	}

	function updateComparisonModifiedQuery(value: string) {
		if (!comparisonModifiedTab) return;
		queryTabsController.updateComparisonQuery('right', value);
		if (comparisonModifiedTab.id === activeQueryTabId) executionState.queryText = value;
	}

	function updateComparisonOriginalQuery(value: string) {
		if (!comparisonOriginalTab) return;
		queryTabsController.updateComparisonQuery('left', value);
		if (comparisonOriginalTab.id === activeQueryTabId) executionState.queryText = value;
	}

	async function runComparisonQuery(side = tabComparisonState.focusedComparisonSide) {
		const tab = side === 'left' ? comparisonOriginalTab : comparisonModifiedTab;
		if (!tab) return;
		if (tab.id !== activeQueryTabId) {
			loadQueryTab(tab);
			await tick();
		}
		await queryExecution.run();
	}

	function syncConnectionSelection() {
		const state = connectionLifecycle.state;
		selectedDatabase = state.selectedDatabase;
		selectedTable = state.selectedTable;
		selectedFunction = state.selectedFunction;
	}

	async function refreshSchema() {
		const state = connectionLifecycle.state;
		state.selectedClusterId = selectedClusterId;
		state.selectedDatabase = selectedDatabase;
		state.selectedTable = selectedTable;
		state.selectedFunction = selectedFunction;
		await connectionLifecycle.refresh();
		syncConnectionSelection();
	}

	function switchCluster(clusterId: string) {
		if (clusterId === selectedClusterId) return;
		connectionLifecycle.switchCluster(clusterId);
		syncConnectionSelection();
	}

	function addCluster(draft: NewClusterConnection) {
		connectionLifecycle.addCluster(draft);
		syncConnectionSelection();
	}

	function editCluster(clusterId: string, draft: NewClusterConnection) {
		connectionLifecycle.editCluster(clusterId, draft);
		syncConnectionSelection();
	}

	async function removeCluster(clusterId: string) {
		await connectionLifecycle.removeCluster(clusterId);
		syncConnectionSelection();
	}

	function retryFailedCluster() {
		connectionLifecycle.retry();
		syncConnectionSelection();
	}

	function dismissConnectionFailure() {
		connectionLifecycle.dismissFailure();
		syncConnectionSelection();
	}

	function openQuery(query: ExplorerQuery) {
		if (view === 'editor') {
			savedQueryController.load(query);
			return;
		}

		savedQueryController.openFromNonEditorView(query);
	}

	function openExplorerSelection(selection: ExplorerSelection) {
		if (view === 'editor') return;
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

	function saveQuery(tab = saveTargetTab) {
		savedQueryController.save(tab);
	}

	function saveCurrentQuery() {
		savedQueryController.saveNew(saveTargetTab);
	}

	function preventRefreshWithQuery(event: BeforeUnloadEvent) {
		if (!queryTabs.some((tab) => queryTabsController.isDirty(tab))) return;
		event.preventDefault();
		event.returnValue = '';
	}

	$effect(() => {
		if (!clusterConnectionStore.hydrated || hasInitializedConnection) return;
		hasInitializedConnection = true;
		void connectionLifecycle.retryPendingCleanups();
		const persistedClusterId = getPersistedActiveClusterId();
		if (
			!clusterSession.databaseSchema &&
			persistedClusterId &&
			clusters.some((cluster) => cluster.id === persistedClusterId)
		) {
			connectionLifecycle.state.selectedClusterId = persistedClusterId;
		}
		if (
			!clusterSession.isSchemaFresh(
				selectedClusterId,
				isSelectedLogAnalyticsCluster ? LOG_ANALYTICS_SCHEMA_TTL_MS : Number.POSITIVE_INFINITY
			)
		) {
			void refreshSchema();
		}
	});

	onMount(() => {
		window.addEventListener('beforeunload', preventRefreshWithQuery);
		return () => {
			connectionLifecycle.dispose();
			queryExecution.dispose();
			disposeKqlTranslator();
			window.removeEventListener('beforeunload', preventRefreshWithQuery);
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
		switching={isClusterSwitching}
		onclusterchange={switchCluster}
		onclusteradd={addCluster}
		onclusteredit={editCluster}
		onclusterremove={removeCluster}
		onlinkauthenticationprofile={(clusterId, authenticationProfileId) => {
			clusterConnectionStore.linkLogAnalyticsAuthenticationProfile(
				clusterId,
				authenticationProfileId
			);
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
		onselectionchange={view === 'editor' ? undefined : openExplorerSelection}
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
		title=""
		sidebarToggleLabel="Toggle cluster explorer"
	/>

	{#if view === 'overview'}
		{#if explorerHeroModule}
			{#await explorerHeroModule}
				<div class="grid min-h-48 flex-1 place-items-center" aria-label="Loading Explorer overview">
					<Spinner />
				</div>
			{:then module}
				<module.default
					clusterName={activeClusterName}
					databaseCount={connectionStatistics.databaseCount}
					tableCount={connectionStatistics.tableCount}
					functionCount={connectionStatistics.functionCount}
					databases={databaseSchema ?? {}}
					{recentQueries}
					{savedQueries}
					emulatedStorage={activeCluster?.emulatedStorage}
					onqueryopen={openQuery}
					onselectionopen={openExplorerSelection}
				/>
			{/await}
		{/if}
	{:else if view === 'saved-queries'}
		{#if savedQueriesPageModule}
			{#await savedQueriesPageModule}
				<div class="grid min-h-48 flex-1 place-items-center" aria-label="Loading saved queries">
					<Spinner />
				</div>
			{:then module}
				<module.default queries={savedQueries} onopen={openQuery} delete={deleteSavedQuery} />
			{/await}
		{/if}
	{:else}
		{#if queryEditorWorkspaceModule}
			{#await queryEditorWorkspaceModule}
				<div class="grid min-h-48 flex-1 place-items-center" aria-label="Loading query workspace">
					<Spinner />
				</div>
			{:then module}
				<module.default
					bind:this={editorWorkspace}
					{databaseSchema}
					{selectedDatabase}
					bind:selectedTable
					bind:selectedFunction
					{explorerExpansion}
					{activeClusterUrl}
					activeTab={activeQueryTab}
					originalTab={comparisonOriginalTab}
					modifiedTab={comparisonModifiedTab}
					{compareCandidates}
					{queryTabs}
					comparisonOriginalTabId={tabComparisonState.comparisonOriginalTabId}
					focusedComparisonSide={tabComparisonState.focusedComparisonSide}
					{executionState}
					{connectionStatus}
					{connectionError}
					{isClusterSwitching}
					{showLogAnalyticsSignInTip}
					{isSelectedLogAnalyticsCluster}
					{selectedClusterName}
					{isQueryable}
					{isMockCluster}
					{isEmulatedCluster}
					emulatedStorage={activeCluster?.emulatedStorage}
					{connectionStatistics}
					{languageServiceStatus}
					{failedClusterId}
					canSave={canSaveTargetQuery &&
						!Boolean(saveTargetSavedQuery && !isSaveTargetSavedQueryDirty)}
					saveTitle={saveTargetSavedQuery
						? isSaveTargetSavedQueryDirty
							? `Update ${saveTargetSavedQuery.name}`
							: 'No saved-query changes'
						: 'Save query locally'}
					titleFor={queryTabsController.titleFor}
					isDirty={queryTabsController.isDirty}
					onselecttab={queryTabsController.select}
					oncomparetab={queryTabsController.compareWith}
					onclosetab={queryTabsController.close}
					oncreatetab={() => queryTabsController.create()}
					onstartcomparison={queryTabsController.startComparison}
					onstopcomparison={queryTabsController.stopComparison}
					onsave={() => saveQuery()}
					onrun={() => void queryExecution.run()}
					onruncomparison={(side) => void runComparisonQuery(side)}
					oncancel={queryExecution.cancel}
					onquerychange={queryExecution.updateQuery}
					onmodifiedchange={updateComparisonModifiedQuery}
					onoriginalchange={updateComparisonOriginalQuery}
					onexpansionchange={updateExplorerExpansion}
					onrefresh={() => void refreshSchema()}
					onretry={retryFailedCluster}
					onlanguagestatuschange={(status) => (languageServiceStatus = status)}
					oncomparisonoriginalchange={(tabId) =>
						(tabComparisonState.comparisonOriginalTabId = tabId)}
					oncomparisonsidechange={(side) => (tabComparisonState.focusedComparisonSide = side)}
					onresultscollapsedchange={(collapsed) => (executionState.resultsCollapsed = collapsed)}
				/>
			{/await}
		{/if}
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

	<SaveQueryDialog
		bind:dialogOpen={savedQueryState.dialogOpen}
		bind:name={savedQueryState.name}
		nameError={savedQueryState.nameError}
		database={saveTargetTab?.database}
		onsave={saveCurrentQuery}
	/>
</AppShell>
