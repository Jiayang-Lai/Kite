<script lang="ts">
	import { goto } from '$app/navigation';
	import AppHeader from '$lib/components/app/app-header.svelte';
	import AppShell from '$lib/components/app/app-shell.svelte';
	import ClusterConnectionSelector from '$lib/components/cluster/cluster-connection-selector.svelte';
	import ConnectionFailureDialog from '$lib/components/cluster/connection-failure-dialog.svelte';
	import DatabaseExplorer from '$lib/components/query/database-explorer.svelte';
	import { Spinner } from '$lib/components/ui/spinner';
	import type {
		ExplorerQuery,
		ExplorerSelection
	} from '$lib/components/query/database-explorer/cluster-explorer-types';
	import { getClusterSession } from '$lib/cluster/cluster-session.svelte';
	import {
		getPersistedActiveClusterId,
		persistActiveClusterId
	} from '$lib/cluster/active-cluster-preference';
	import {
		getClusterConnectionStore,
		type NewClusterConnection
	} from '$lib/cluster/cluster-connection-store.svelte';
	import { createConnectionLifecycleController } from '$lib/query/connection-lifecycle-controller.svelte';
	import { getConnectionCapabilities } from '$lib/cluster/connection-capabilities';
	import { usesBuiltInMockCatalog } from '$lib/cluster/mock-cluster-schema';
	import { MOCK_RECENT_QUERIES, MOCK_SAVED_QUERIES } from '$lib/data/mock-queries';
	import { getRecentQueryStore } from '$lib/query/recent-query-store.svelte';
	import { getSavedQueryStore } from '$lib/query/saved-query-store.svelte';

	type AdminView = 'overview' | 'commands' | 'databases' | 'ingestion';

	type AdminWorkspaceProps = {
		view?: AdminView;
	};

	let { view = 'overview' }: AdminWorkspaceProps = $props();
	const adminHeroModule = $derived(
		view === 'overview' ? import('$lib/components/admin/admin-hero.svelte') : undefined
	);
	const databaseManagementModule = $derived(
		view === 'databases' ? import('$lib/components/admin/database-management.svelte') : undefined
	);
	const managementCommandModule = $derived(
		view === 'commands'
			? import('$lib/components/admin/management-command-workspace.svelte')
			: undefined
	);
	const dataIngestionModule = $derived(
		view === 'ingestion'
			? import('$lib/components/admin/data-ingestion-workspace.svelte')
			: undefined
	);
	const clusterConnectionStore = getClusterConnectionStore();
	const clusters = $derived(clusterConnectionStore.clusters);
	const customClusters = $derived(clusterConnectionStore.customClusters);
	const clusterSession = getClusterSession();
	const recentQueryStore = getRecentQueryStore();
	const savedQueryStore = getSavedQueryStore();
	type ConnectionStatus = 'loading' | 'ready' | 'error';
	let connectionStatus = $state<ConnectionStatus>(
		clusterSession.databaseSchema ? 'ready' : 'loading'
	);
	let connectionError = $state('');
	let isClusterSwitching = $state(false);
	let isTableMutating = $state(false);
	let selectedClusterId = $state(clusterSession.activeClusterId);
	let failedClusterId = $state<string>();
	let explorerFilter = $state('');
	let selectedDatabase = $state(clusterSession.selectedDatabase);
	let selectedTable = $state(clusterSession.selectedTable);
	let selectedFunction = $state(clusterSession.selectedFunction);
	let hasInitializedConnection = false;
	const initialCluster =
		clusterConnectionStore.clusters.find(
			(cluster) => cluster.id === clusterSession.activeClusterId
		) ?? clusterConnectionStore.clusters[0];
	const connectionLifecycle = createConnectionLifecycleController({
		store: clusterConnectionStore,
		session: clusterSession,
		initialCluster,
		onQueryExecutionReset: () => undefined,
		onSchemaReady: () => undefined,
		onstatechange: () => syncConnectionState()
	});
	const databaseSchema = $derived(clusterSession.databaseSchema);
	const databaseCount = $derived(Object.keys(databaseSchema ?? {}).length);
	const tableCount = $derived(
		Object.values(databaseSchema ?? {}).reduce(
			(count, database) => count + database.tables.length,
			0
		)
	);
	const activeCluster = $derived(
		clusters.find((cluster) => cluster.id === clusterSession.activeClusterId)
	);
	const activeCapabilities = $derived(getConnectionCapabilities(activeCluster));
	let activeClusterUrl = $state(
		clusterConnectionStore.clusters.find((cluster) => cluster.id === clusterSession.activeClusterId)
			?.url ?? ''
	);
	const isMockCluster = $derived(activeCluster?.kind === 'mock');
	const isEmulatedCluster = $derived(activeCluster?.kind === 'emulated');
	const isLogAnalyticsCluster = $derived(activeCluster?.kind === 'log-analytics');
	const hasBuiltInMockSamples = $derived(usesBuiltInMockCatalog(activeCluster));
	const activeClusterName = $derived(activeCluster?.name ?? 'current cluster');
	const failedClusterName = $derived(
		clusters.find((cluster) => cluster.id === failedClusterId)?.name ?? 'selected cluster'
	);
	let explorerExpansion = $state(
		clusterSession.getExplorerExpansion(clusterSession.activeClusterId)
	);
	const storedRecentQueries = $derived<ExplorerQuery[]>(
		recentQueryStore.forCluster(clusterSession.activeClusterId)
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
		...savedQueryStore.forCluster(clusterSession.activeClusterId)
	]);
	const activeView = $derived(
		{
			overview: {
				title: 'Kusto Admin',
				description: 'Manage the selected Kusto cluster.'
			},
			commands: {
				title: 'Management commands',
				description: 'Run and inspect administrative Kusto commands.'
			},
			databases: {
				title: 'Databases & tables',
				description:
					'Browse database schemas, update tables, and inspect stored functions for the selected cluster.'
			},
			ingestion: {
				title: 'Data ingestion',
				description: 'Append CSV or Parquet data to a table.'
			}
		}[view]
	);

	function selectRecentQuery(query: ExplorerQuery) {
		selectedDatabase = query.database;
		selectedTable = undefined;
		selectedFunction = undefined;
		clusterSession.selectedDatabase = query.database;
		clusterSession.selectedTable = undefined;
		clusterSession.selectedFunction = undefined;
		clusterSession.pendingQuery = query.query;
		void goto('/explorer/query');
	}

	function openInQuery(selection: ExplorerSelection) {
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
		clusterSession.setExplorerExpansion(clusterSession.activeClusterId, change);
	}

	async function connectCluster(clusterId = selectedClusterId) {
		const state = connectionLifecycle.state;
		state.selectedClusterId = clusterId;
		state.selectedDatabase = selectedDatabase;
		state.selectedTable = selectedTable;
		state.selectedFunction = selectedFunction;
		await connectionLifecycle.refresh();
		syncConnectionState();
		return state.connectionStatus === 'ready';
	}

	function syncConnectionState() {
		const state = connectionLifecycle.state;
		connectionStatus = state.connectionStatus;
		isClusterSwitching = state.isClusterSwitching;
		connectionError = state.connectionError;
		failedClusterId = state.failedClusterId;
		selectedClusterId = state.selectedClusterId;
		activeClusterUrl = state.activeClusterUrl;
		selectedDatabase = state.selectedDatabase;
		selectedTable = state.selectedTable;
		selectedFunction = state.selectedFunction;
	}

	function switchCluster(clusterId: string) {
		if (clusterId === selectedClusterId || isClusterSwitching) return;
		selectedClusterId = clusterId;
		void connectCluster(clusterId);
	}

	function addCluster(draft: NewClusterConnection) {
		const cluster = clusterConnectionStore.add(draft);
		switchCluster(cluster.id);
	}

	function editCluster(clusterId: string, draft: NewClusterConnection) {
		clusterConnectionStore.update(clusterId, draft);
		if (clusterId === selectedClusterId) void connectCluster(clusterId);
	}

	async function removeCluster(clusterId: string) {
		await connectionLifecycle.removeCluster(clusterId);
		selectedClusterId = connectionLifecycle.state.selectedClusterId;
	}

	function retryFailedCluster() {
		connectionLifecycle.retry();
		void connectCluster(connectionLifecycle.state.selectedClusterId);
	}

	function dismissConnectionFailure() {
		connectionLifecycle.dismissFailure();
		connectionStatus = connectionLifecycle.state.connectionStatus;
		connectionError = connectionLifecycle.state.connectionError;
		failedClusterId = connectionLifecycle.state.failedClusterId;
	}

	$effect(() => {
		clusterSession.selectedDatabase = selectedDatabase;
		clusterSession.selectedTable = selectedTable;
		clusterSession.selectedFunction = selectedFunction;
	});

	$effect(() => {
		explorerExpansion = clusterSession.getExplorerExpansion(clusterSession.activeClusterId);
	});

	$effect(() => {
		if (!clusterConnectionStore.hydrated || hasInitializedConnection) return;
		hasInitializedConnection = true;
		const persistedClusterId = getPersistedActiveClusterId();
		if (
			!clusterSession.databaseSchema &&
			persistedClusterId &&
			clusters.some((cluster) => cluster.id === persistedClusterId)
		) {
			selectedClusterId = persistedClusterId;
		}
		if (!clusterSession.databaseSchema) void connectCluster();
	});
</script>

{#snippet sidebarHeader()}
	<ClusterConnectionSelector
		{clusters}
		{customClusters}
		{selectedClusterId}
		disabled={isClusterSwitching || isTableMutating}
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
		showCluster
		clusterDisabled={isClusterSwitching || isTableMutating || connectionStatus === 'loading'}
		bind:selectedDatabase
		bind:selectedTable
		bind:selectedFunction
		expansionState={explorerExpansion}
		onexpansionchange={updateExplorerExpansion}
		{recentQueries}
		{savedQueries}
		bind:filter={explorerFilter}
		onqueryselect={selectRecentQuery}
		onselectionchange={openInQuery}
		onsavedquerydelete={deleteSavedQuery}
		onrecentquerydelete={deleteRecentQuery}
	/>
	{#if connectionStatus === 'error' && !databaseSchema}
		<p class="text-destructive px-4 pb-2 text-xs" role="alert">
			Unable to load cluster schema: {connectionError}
		</p>
	{/if}
{/snippet}

<AppShell {sidebarHeader} {sidebarContent}>
	<AppHeader
		breadcrumbs={view === 'overview'
			? [{ label: 'Kite', href: '/' }, { label: 'Admin' }]
			: [
					{ label: 'Kite', href: '/' },
					{ label: 'Admin', href: '/admin' },
					{ label: activeView.title }
				]}
		title={view === 'overview' || view === 'databases' || view === 'ingestion'
			? ''
			: activeView.title}
		sidebarToggleLabel="Toggle admin navigation"
	>
		{#if view === 'commands'}
			<p class="text-muted-foreground mt-1 text-sm">{activeView.description}</p>
		{/if}
	</AppHeader>

	{#if view === 'overview'}
		{#if adminHeroModule}
			{#await adminHeroModule}
				<div class="grid min-h-48 flex-1 place-items-center" aria-label="Loading admin overview">
					<Spinner />
				</div>
			{:then module}
				<module.default
					clusterName={activeClusterName}
					{databaseCount}
					{tableCount}
					{connectionStatus}
					{connectionError}
					capabilities={activeCapabilities}
					emulatedStorage={activeCluster?.emulatedStorage}
				/>
			{/await}
		{/if}
	{:else if view === 'databases'}
		{#if databaseManagementModule}
			{#await databaseManagementModule}
				<div class="grid min-h-48 flex-1 place-items-center" aria-label="Loading databases">
					<Spinner />
				</div>
			{:then module}
				<module.default
					databases={databaseSchema}
					bind:selectedDatabase
					expansionState={explorerExpansion}
					onexpansionchange={updateExplorerExpansion}
					clusterId={clusterSession.activeClusterId}
					clusterUrl={activeClusterUrl}
					clusterName={activeClusterName}
					isLoading={connectionStatus === 'loading'}
					onrefreshschema={async (clusterId) => {
						if (!(await connectCluster(clusterId))) {
							throw new Error('The backend schema refresh did not complete.');
						}
					}}
					onmutationstatechange={(running) => (isTableMutating = running)}
					onopenquery={(database) =>
						openInQuery({
							database
						})}
				/>
			{/await}
		{/if}
	{:else if view === 'commands'}
		{#if managementCommandModule}
			{#await managementCommandModule}
				<div class="grid min-h-48 flex-1 place-items-center" aria-label="Loading commands">
					<Spinner />
				</div>
			{:then module}
				<module.default
					databases={databaseSchema}
					bind:selectedDatabase
					clusterUrl={activeClusterUrl}
					clusterName={activeClusterName}
					{isMockCluster}
					{isEmulatedCluster}
					{isLogAnalyticsCluster}
					managementCommands={activeCapabilities.managementCommands}
					onrefreshschema={async () => {
						await connectCluster(clusterSession.activeClusterId);
					}}
				/>
			{/await}
		{/if}
	{:else}
		{#if dataIngestionModule}
			{#await dataIngestionModule}
				<div class="grid min-h-48 flex-1 place-items-center" aria-label="Loading ingestion">
					<Spinner />
				</div>
			{:then module}
				{#key clusterSession.activeClusterId}
					<module.default
						databases={databaseSchema}
						bind:selectedDatabase
						bind:selectedTable
						clusterId={clusterSession.activeClusterId}
						clusterUrl={activeClusterUrl}
						clusterName={activeClusterName}
						ingestion={activeCluster?.ingestion}
						emulatedStorage={activeCluster?.emulatedStorage}
						{isMockCluster}
						{isEmulatedCluster}
						ingestionEnabled={activeCapabilities.ingestion !== 'none'}
						isLoading={connectionStatus === 'loading'}
					/>
				{/key}
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
</AppShell>
