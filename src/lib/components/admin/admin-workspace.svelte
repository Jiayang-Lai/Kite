<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
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
	import { createConfirmationPrompt } from '$lib/app/confirmation-prompt.svelte';
	import ConfirmationPromptDialog from '$lib/components/shared/confirmation-prompt-dialog.svelte';
	import { getClusterSession } from '$lib/cluster/cluster-session.svelte';
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
	const confirmationPrompt = createConfirmationPrompt();
	const recentQueryStore = getRecentQueryStore();
	const savedQueryStore = getSavedQueryStore();
	let isTableMutating = $state(false);
	let explorerFilter = $state('');
	const connectionLifecycle = createConnectionLifecycleController({
		store: clusterConnectionStore,
		session: clusterSession,
		confirm: confirmationPrompt.ask
	});
	const connectionStatus = $derived(connectionLifecycle.state.connectionStatus);
	const connectionError = $derived(connectionLifecycle.state.connectionError);
	const isClusterSwitching = $derived(connectionLifecycle.state.isClusterSwitching);
	const selectedClusterId = $derived(connectionLifecycle.state.selectedClusterId);
	const failedClusterId = $derived(connectionLifecycle.state.failedClusterId);
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
	const activeClusterUrl = $derived(activeCluster?.url ?? '');
	const activeCapabilities = $derived(getConnectionCapabilities(activeCluster));
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

	function switchCluster(clusterId: string) {
		connectionLifecycle.switchCluster(clusterId);
	}

	$effect(() => {
		explorerExpansion = clusterSession.getExplorerExpansion(clusterSession.activeClusterId);
	});

	$effect(() => {
		if (clusterConnectionStore.hydrated) connectionLifecycle.initialize();
	});

	onDestroy(() => connectionLifecycle.dispose());
</script>

{#snippet sidebarHeader()}
	<ClusterConnectionSelector
		{clusters}
		{customClusters}
		{selectedClusterId}
		disabled={isClusterSwitching || isTableMutating}
		switching={isClusterSwitching}
		onclusterchange={switchCluster}
		onclusteradd={connectionLifecycle.addCluster}
		onclusteredit={connectionLifecycle.editCluster}
		onclusterremove={connectionLifecycle.removeCluster}
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
		bind:selectedDatabase={clusterSession.selectedDatabase}
		bind:selectedTable={clusterSession.selectedTable}
		bind:selectedFunction={clusterSession.selectedFunction}
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
		<p class="px-4 pb-2 text-xs text-destructive" role="alert">
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
			<p class="mt-1 text-sm text-muted-foreground">{activeView.description}</p>
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
					bind:selectedDatabase={clusterSession.selectedDatabase}
					expansionState={explorerExpansion}
					onexpansionchange={updateExplorerExpansion}
					clusterId={clusterSession.activeClusterId}
					clusterUrl={activeClusterUrl}
					clusterName={activeClusterName}
					isLoading={connectionStatus === 'loading'}
					onrefreshschema={async (clusterId) => {
						if (!(await connectionLifecycle.connect(clusterId))) {
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
					bind:selectedDatabase={clusterSession.selectedDatabase}
					clusterUrl={activeClusterUrl}
					clusterName={activeClusterName}
					{isMockCluster}
					{isEmulatedCluster}
					{isLogAnalyticsCluster}
					managementCommands={activeCapabilities.managementCommands}
					onrefreshschema={async () => {
						await connectionLifecycle.connect(clusterSession.activeClusterId);
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
						bind:selectedDatabase={clusterSession.selectedDatabase}
						bind:selectedTable={clusterSession.selectedTable}
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
			oncontinue={connectionLifecycle.dismissFailure}
			onretry={connectionLifecycle.retry}
		/>
	{/if}
</AppShell>

<ConfirmationPromptDialog prompt={confirmationPrompt} />
