<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	import AppHeader from '$lib/components/app/app-header.svelte';
	import AppShell from '$lib/components/app/app-shell.svelte';
	import AdminHero from '$lib/components/admin/admin-hero.svelte';
	import DataIngestionWorkspace from '$lib/components/admin/data-ingestion-workspace.svelte';
	import DatabaseManagement from '$lib/components/admin/database-management.svelte';
	import ManagementCommandWorkspace from '$lib/components/admin/management-command-workspace.svelte';
	import ClusterConnectionSelector from '$lib/components/cluster/cluster-connection-selector.svelte';
	import ConnectionFailureDialog from '$lib/components/cluster/connection-failure-dialog.svelte';
	import DatabaseExplorer from '$lib/components/query/database-explorer.svelte';
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
	import { getMockClusterSchema, usesBuiltInMockCatalog } from '$lib/cluster/mock-cluster-schema';
	import { MOCK_RECENT_QUERIES, MOCK_SAVED_QUERIES } from '$lib/data/mock-queries';
	import { deletePersistentDuckDbStorage, disposeDuckDb } from '$lib/duckdb/query-client';
	import { loadEmulatedSchema } from '$lib/emulated/emulated-cluster';
	import { registerEmulatedStorage } from '$lib/emulated/storage';
	import { loadBackendSchema } from '$lib/kusto/backend-schema';
	import { getKustoErrorMessage } from '$lib/kusto/query-client';
	import { getRecentQueryStore } from '$lib/query/recent-query-store.svelte';
	import { getSavedQueryStore } from '$lib/query/saved-query-store.svelte';

	type AdminView = 'overview' | 'commands' | 'databases' | 'ingestion';

	type AdminWorkspaceProps = {
		view?: AdminView;
	};

	let { view = 'overview' }: AdminWorkspaceProps = $props();
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
	let schemaRequestId = 0;
	let explorerFilter = $state('');
	let selectedDatabase = $state(clusterSession.selectedDatabase);
	let selectedTable = $state(clusterSession.selectedTable);
	let selectedFunction = $state(clusterSession.selectedFunction);
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
	let activeClusterUrl = $state(
		clusterConnectionStore.clusters.find((cluster) => cluster.id === clusterSession.activeClusterId)
			?.url ?? ''
	);
	const isMockCluster = $derived(activeCluster?.kind === 'mock');
	const isEmulatedCluster = $derived(activeCluster?.kind === 'emulated');
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
		const requestId = ++schemaRequestId;
		const cluster = clusterConnectionStore.clusters.find((item) => item.id === clusterId);
		if (!cluster) return false;

		connectionStatus = 'loading';
		isClusterSwitching = Boolean(clusterSession.databaseSchema);
		connectionError = '';
		try {
			if (cluster.kind === 'emulated') {
				registerEmulatedStorage(cluster.id, cluster.emulatedStorage);
			}
			const schema =
				cluster.kind === 'mock'
					? getMockClusterSchema(cluster)
					: cluster.kind === 'emulated'
						? await loadEmulatedSchema(cluster.id)
						: await loadBackendSchema(cluster.url);
			if (requestId !== schemaRequestId || clusterId !== selectedClusterId) return false;
			const firstDatabase = Object.values(schema)[0];
			const shouldRestoreSelection = clusterId === clusterSession.activeClusterId;
			const activeDatabase = shouldRestoreSelection
				? (schema[selectedDatabase] ?? firstDatabase)
				: firstDatabase;

			clusterSession.getExplorerExpansion(clusterId);
			clusterSession.activeClusterId = clusterId;
			persistActiveClusterId(clusterId);
			activeClusterUrl = cluster.url;
			clusterSession.databaseSchema = schema;
			selectedDatabase = activeDatabase.name;
			selectedTable =
				shouldRestoreSelection &&
				activeDatabase.tables.some((table) => table.name === selectedTable)
					? selectedTable
					: undefined;
			selectedFunction =
				shouldRestoreSelection &&
				activeDatabase.functions?.some((fn) => fn.name === selectedFunction)
					? selectedFunction
					: undefined;
			connectionStatus = 'ready';
			isClusterSwitching = false;
			failedClusterId = undefined;
			return true;
		} catch (error) {
			if (requestId !== schemaRequestId) return false;
			connectionError = getKustoErrorMessage(error);
			connectionStatus = 'error';
			isClusterSwitching = false;
			failedClusterId = clusterId;
			selectedClusterId = clusterSession.activeClusterId;
			return false;
		}
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
		const wasSelected =
			clusterId === selectedClusterId || clusterId === clusterSession.activeClusterId;
		const removedCluster = clusters.find((cluster) => cluster.id === clusterId);
		if (removedCluster?.kind === 'emulated') {
			await disposeDuckDb(clusterId);
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
		void connectCluster(failedClusterId);
	}

	function dismissConnectionFailure() {
		connectionStatus = 'ready';
		connectionError = '';
		failedClusterId = undefined;
	}

	$effect(() => {
		clusterSession.selectedDatabase = selectedDatabase;
		clusterSession.selectedTable = selectedTable;
		clusterSession.selectedFunction = selectedFunction;
	});

	$effect(() => {
		explorerExpansion = clusterSession.getExplorerExpansion(clusterSession.activeClusterId);
	});

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
		if (!clusterSession.databaseSchema) void connectCluster();
	});
</script>

{#snippet sidebarHeader()}
	<ClusterConnectionSelector
		{clusters}
		{customClusters}
		{selectedClusterId}
		disabled={isClusterSwitching || isTableMutating}
		onclusterchange={switchCluster}
		onclusteradd={addCluster}
		onclusteredit={editCluster}
		onclusterremove={removeCluster}
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
		title={view === 'overview' || view === 'databases' ? '' : activeView.title}
		sidebarToggleLabel="Toggle admin navigation"
	>
		{#if view === 'commands' || view === 'ingestion'}
			<p class="text-muted-foreground mt-1 text-sm">{activeView.description}</p>
		{/if}
	</AppHeader>

	{#if view === 'overview'}
		<AdminHero clusterName={activeClusterName} {databaseCount} {tableCount} />
	{:else if view === 'databases'}
		<DatabaseManagement
			databases={databaseSchema}
			bind:selectedDatabase
			expansionState={explorerExpansion}
			onexpansionchange={updateExplorerExpansion}
			clusterId={clusterSession.activeClusterId}
			clusterUrl={activeClusterUrl}
			clusterName={activeClusterName}
			{isMockCluster}
			{isEmulatedCluster}
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
	{:else if view === 'commands'}
		<ManagementCommandWorkspace
			databases={databaseSchema}
			bind:selectedDatabase
			clusterUrl={activeClusterUrl}
			clusterName={activeClusterName}
			{isMockCluster}
			{isEmulatedCluster}
			onrefreshschema={async () => {
				await connectCluster(clusterSession.activeClusterId);
			}}
		/>
	{:else}
		{#key clusterSession.activeClusterId}
			<DataIngestionWorkspace
				databases={databaseSchema}
				bind:selectedDatabase
				bind:selectedTable
				clusterId={clusterSession.activeClusterId}
				clusterUrl={activeClusterUrl}
				clusterName={activeClusterName}
				ingestion={activeCluster?.ingestion}
				{isMockCluster}
				{isEmulatedCluster}
				isLoading={connectionStatus === 'loading'}
			/>
		{/key}
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
