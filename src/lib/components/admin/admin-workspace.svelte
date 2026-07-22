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
	import { persistActiveClusterId } from '$lib/cluster/active-cluster-preference';
	import { MOCK_DATABASES } from '$lib/data/mock-databases';
	import { MOCK_RECENT_QUERIES, MOCK_SAVED_QUERIES } from '$lib/data/mock-queries';
	import { loadBackendSchema } from '$lib/kusto/backend-schema';
	import {
		getKustoClusters,
		getKustoErrorMessage,
		MOCK_KUSTO_CLUSTER_URL
	} from '$lib/kusto/query-client';
	import { getRecentQueryStore } from '$lib/query/recent-query-store.svelte';
	import { getSavedQueryStore } from '$lib/query/saved-query-store.svelte';

	type AdminView = 'overview' | 'commands' | 'databases' | 'ingestion';

	type AdminWorkspaceProps = {
		view?: AdminView;
	};

	let { view = 'overview' }: AdminWorkspaceProps = $props();
	const clusters = getKustoClusters();
	const clusterSession = getClusterSession();
	const recentQueryStore = getRecentQueryStore();
	const savedQueryStore = getSavedQueryStore();
	type ConnectionStatus = 'loading' | 'ready' | 'error';
	let connectionStatus = $state<ConnectionStatus>(
		clusterSession.databaseSchema ? 'ready' : 'loading'
	);
	let connectionError = $state('');
	let isClusterSwitching = $state(false);
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
	const isMockCluster = $derived(activeCluster?.url === MOCK_KUSTO_CLUSTER_URL);
	const activeClusterName = $derived(activeCluster?.name ?? 'current cluster');
	const activeClusterUrl = $derived(activeCluster?.url ?? '');
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
		storedRecentQueries.length ? storedRecentQueries : isMockCluster ? MOCK_RECENT_QUERIES : []
	);
	const savedQueries = $derived<ExplorerQuery[]>([
		...(isMockCluster ? MOCK_SAVED_QUERIES : []),
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
					'Browse database schemas, tables, and stored functions for the selected cluster.'
			},
			ingestion: {
				title: 'Data ingestion',
				description: 'Append inline CSV or mounted files to a Kustainer table.'
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
		const cluster = clusters.find((item) => item.id === clusterId);
		if (!cluster) return;

		connectionStatus = 'loading';
		isClusterSwitching = Boolean(clusterSession.databaseSchema);
		connectionError = '';
		try {
			const schema =
				cluster.url === MOCK_KUSTO_CLUSTER_URL
					? MOCK_DATABASES
					: await loadBackendSchema(cluster.url);
			if (requestId !== schemaRequestId || clusterId !== selectedClusterId) return;
			const firstDatabase = Object.values(schema)[0];
			const shouldRestoreSelection = clusterId === clusterSession.activeClusterId;
			const activeDatabase = shouldRestoreSelection
				? (schema[selectedDatabase] ?? firstDatabase)
				: firstDatabase;

			clusterSession.getExplorerExpansion(clusterId);
			clusterSession.activeClusterId = clusterId;
			persistActiveClusterId(clusterId);
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
		} catch (error) {
			if (requestId !== schemaRequestId) return;
			connectionError = getKustoErrorMessage(error);
			connectionStatus = 'error';
			isClusterSwitching = false;
			failedClusterId = clusterId;
			selectedClusterId = clusterSession.activeClusterId;
		}
	}

	function switchCluster(clusterId: string) {
		if (clusterId === selectedClusterId || isClusterSwitching) return;
		selectedClusterId = clusterId;
		void connectCluster(clusterId);
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
		if (!clusterSession.databaseSchema) void connectCluster();
	});
</script>

{#snippet sidebarHeader()}
	<ClusterConnectionSelector
		{clusters}
		{selectedClusterId}
		disabled={isClusterSwitching}
		onclusterchange={switchCluster}
	/>
{/snippet}

{#snippet sidebarContent()}
	<DatabaseExplorer
		databases={databaseSchema ?? {}}
		{connectionStatus}
		showCluster
		clusterDisabled={isClusterSwitching || connectionStatus === 'loading'}
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
			bind:selectedTable
			bind:selectedFunction
			isLoading={connectionStatus === 'loading'}
			onopenquery={() =>
				openInQuery({
					database: selectedDatabase,
					table: selectedTable,
					function: selectedFunction
				})}
		/>
	{:else if view === 'commands'}
		<ManagementCommandWorkspace
			databases={databaseSchema}
			bind:selectedDatabase
			clusterUrl={activeClusterUrl}
			clusterName={activeClusterName}
			{isMockCluster}
			onrefreshschema={() => connectCluster(clusterSession.activeClusterId)}
		/>
	{:else}
		{#key clusterSession.activeClusterId}
			<DataIngestionWorkspace
				databases={databaseSchema}
				bind:selectedDatabase
				bind:selectedTable
				clusterUrl={activeClusterUrl}
				clusterName={activeClusterName}
				ingestion={activeCluster?.ingestion}
				{isMockCluster}
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
