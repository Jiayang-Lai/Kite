<script lang="ts">
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import FileDownIcon from '@lucide/svelte/icons/file-down';
	import FileCode2Icon from '@lucide/svelte/icons/file-code-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import TablePropertiesIcon from '@lucide/svelte/icons/table-properties';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { onDestroy } from 'svelte';

	import ColumnActionsMenu from '$lib/components/admin/column-actions-menu.svelte';
	import DatabaseActionsMenu from '$lib/components/admin/database-actions-menu.svelte';
	import DatabaseMutationWorkspace from '$lib/components/admin/database-mutation-workspace.svelte';
	import { getClusterConnectionStore } from '$lib/cluster/cluster-connection-store.svelte';
	import { getConnectionCapabilities } from '$lib/cluster/connection-capabilities';
	import { createDatabaseMutationWorkspace } from '$lib/admin/database-mutation-workspace.svelte';
	import type {
		ExplorerExpansionChange,
		ExplorerExpansionState
	} from '$lib/cluster/cluster-session.svelte';
	import DatabaseSchema from '$lib/components/cluster/database-schema.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { buildAvroDatabaseExport, buildAvroTableSchema } from '$lib/kusto/avro-table-template';
	import type {
		KustoColumn,
		KustoDatabase,
		KustoDatabaseSchema,
		KustoTable
	} from '$lib/types/kusto-schema';

	type DatabaseManagementProps = {
		databases?: KustoDatabaseSchema;
		selectedDatabase?: string;
		expansionState: ExplorerExpansionState;
		onexpansionchange: (change: ExplorerExpansionChange) => void;
		clusterId: string;
		clusterUrl: string;
		clusterName: string;
		isLoading?: boolean;
		onopenquery?: (databaseName: string) => void;
		onrefreshschema?: (clusterId: string) => Promise<void> | void;
		onmutationstatechange?: (running: boolean) => void;
	};

	let {
		databases,
		selectedDatabase = $bindable(),
		expansionState,
		onexpansionchange,
		clusterId,
		clusterUrl,
		clusterName,
		isLoading = false,
		onopenquery,
		onrefreshschema,
		onmutationstatechange
	}: DatabaseManagementProps = $props();

	const clusterConnectionStore = getClusterConnectionStore();
	let databaseFilter = $state('');
	const mutationWorkspace = createDatabaseMutationWorkspace({
		store: clusterConnectionStore,
		getClusterId: () => clusterId,
		getDatabases: () => databases,
		getActiveDatabase: () => activeDatabase,
		setSelectedDatabase: (database) => (selectedDatabase = database),
		onrefreshschema: (targetClusterId) => onrefreshschema?.(targetClusterId),
		onmutationstatechange: (running) => onmutationstatechange?.(running)
	});
	const mutationState = mutationWorkspace.state;
	const isBusy = $derived(mutationWorkspace.isBusy);
	const isMutationDialogOpen = $derived(mutationWorkspace.isDialogOpen);
	const databaseEntries = $derived(Object.values(databases ?? {}));
	const activeCluster = $derived(
		clusterConnectionStore.clusters.find((cluster) => cluster.id === clusterId)
	);
	const isMockCluster = $derived(activeCluster?.kind === 'mock');
	const isEmulatedCluster = $derived(activeCluster?.kind === 'emulated');
	const isLogAnalyticsCluster = $derived(activeCluster?.kind === 'log-analytics');
	const databaseCapabilities = $derived(getConnectionCapabilities(activeCluster).databases);
	const visibleDatabases = $derived(
		databaseEntries.filter((database) =>
			`${database.name} ${database.prettyName ?? ''}`
				.toLowerCase()
				.includes(databaseFilter.trim().toLowerCase())
		)
	);
	const activeDatabase = $derived(
		selectedDatabase ? databases?.[selectedDatabase] : databaseEntries[0]
	);

	$effect(() => {
		const firstDatabase = databaseEntries[0];
		if (firstDatabase && !databases?.[selectedDatabase ?? '']) {
			selectedDatabase = firstDatabase.name;
		}
	});

	$effect(() => {
		const isOpen = isMutationDialogOpen;
		if (mutationState.wasDialogOpen && !isOpen && isBusy) mutationWorkspace.cancel();
		mutationState.wasDialogOpen = isOpen;
	});

	$effect(() => {
		if (
			isMutationDialogOpen &&
			mutationState.editorClusterId &&
			mutationState.editorClusterId !== clusterId
		) {
			mutationWorkspace.closeAll();
		}
	});

	function selectDatabase(databaseName: string) {
		if (databaseName === selectedDatabase) return;
		if (isBusy) return;
		mutationWorkspace.closeEditors();
		selectedDatabase = databaseName;
	}

	const openTableEditor = mutationWorkspace.openTableEditor;
	const openColumnEditor = mutationWorkspace.openColumnEditor;
	const openColumnOrderEditor = mutationWorkspace.openColumnOrderEditor;
	const openCreateTableDialog = mutationWorkspace.openCreateTable;
	const openDatabaseDialog = mutationWorkspace.openDatabaseDialog;
	const openDropTableDialog = mutationWorkspace.openDropTable;

	function exportTableSchema(table: KustoTable) {
		const schema = JSON.stringify(buildAvroTableSchema(table), null, '\t');
		const fileName = `${table.name.replaceAll(/[^A-Za-z0-9._-]/g, '_') || 'table'}.avsc`;
		const url = URL.createObjectURL(
			new Blob([`${schema}\n`], { type: 'application/vnd.apache.avro.schema+json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = fileName;
		link.click();
		URL.revokeObjectURL(url);
	}

	function exportDatabaseSchema(database: KustoDatabase) {
		const schema = JSON.stringify(buildAvroDatabaseExport(database), null, '\t');
		const fileName = `${database.name.replaceAll(/[^A-Za-z0-9._-]/g, '_') || 'database'}.schema.json`;
		const url = URL.createObjectURL(new Blob([`${schema}\n`], { type: 'application/json' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = fileName;
		link.click();
		URL.revokeObjectURL(url);
	}

	onDestroy(() => {
		mutationWorkspace.dispose();
	});
</script>

{#snippet schemaActions()}
	{#if databaseCapabilities.create}
		<Button
			size="sm"
			variant="outline"
			disabled={isBusy}
			onclick={openCreateTableDialog}
			title={`Create a table in ${activeDatabase?.name}`}
		>
			<PlusIcon />
			New table
		</Button>
	{/if}
	{#if activeDatabase}
		<Button
			size="sm"
			variant="outline"
			onclick={() => exportDatabaseSchema(activeDatabase)}
			title={`Download all ${activeDatabase.tables.length} table schemas as Avro records`}
		>
			<FileDownIcon />
			Export Schema
		</Button>
	{/if}
	<Button
		size="sm"
		variant="outline"
		onclick={() => activeDatabase && onopenquery?.(activeDatabase.name)}
	>
		<FileCode2Icon />
		Open in Query
	</Button>
{/snippet}

{#snippet tableActions(table: KustoTable)}
	<div class="flex flex-wrap items-center justify-end gap-1">
		<Button
			size="xs"
			variant="outline"
			onclick={() => exportTableSchema(table)}
			title={`Download ${table.name}'s schema as an Avro record`}
		>
			<FileDownIcon />
			Export Schema
		</Button>
		{#if !isLogAnalyticsCluster}
			<Button
				size="xs"
				variant="outline"
				disabled={isBusy}
				onclick={() => openTableEditor(table)}
				title={`Edit ${table.name} without replacing existing columns`}
			>
				<PencilIcon />
				Edit table
			</Button>
			<Button
				size="xs"
				variant="outline"
				disabled={isBusy}
				onclick={() => openColumnOrderEditor(table)}
				title={`Change the column order for ${table.name}`}
			>
				<TablePropertiesIcon />
				Reorder columns
			</Button>
			<Button
				size="xs"
				variant="outline"
				class="text-destructive hover:text-destructive"
				disabled={isBusy}
				onclick={() => openDropTableDialog(table)}
				title={`Remove ${table.name} and all data stored in it`}
			>
				<Trash2Icon />
				Remove table
			</Button>
		{/if}
	</div>
{/snippet}

{#snippet columnActions(table: KustoTable, column: KustoColumn)}
	{@const canonicalTable =
		activeDatabase?.tables.find((candidate) => candidate.name === table.name) ?? table}
	{@const canonicalColumn =
		canonicalTable.columns.find((candidate) => candidate.name === column.name) ?? column}
	{#if !isLogAnalyticsCluster}
		<ColumnActionsMenu
			table={canonicalTable}
			column={canonicalColumn}
			disabled={isBusy}
			onaction={(action) => openColumnEditor(canonicalTable, canonicalColumn, action)}
		/>
	{/if}
{/snippet}

<section class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:flex-row">
	<aside
		class="flex h-52 shrink-0 flex-col border-b bg-card lg:h-auto lg:w-72 lg:border-r lg:border-b-0"
	>
		<header class="shrink-0 border-b px-4 py-3">
			<div class="flex items-center justify-between gap-3">
				<h2 class="text-sm font-semibold">Databases</h2>
				{#if !isLoading && databaseCapabilities.create}
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									size="icon-xs"
									variant="outline"
									disabled={isBusy}
									aria-label="New database"
									onclick={() => openDatabaseDialog('create')}
								>
									<PlusIcon />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">New database</Tooltip.Content>
					</Tooltip.Root>
				{/if}
			</div>
			<p class="text-muted-foreground mt-1 text-xs">
				{databaseEntries.length} on the selected cluster
			</p>
		</header>
		<div class="min-h-0 flex flex-1 flex-col p-3">
			<div class="relative shrink-0">
				<SearchIcon
					class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
				/>
				<Input
					bind:value={databaseFilter}
					class="h-8 pl-9 text-xs"
					placeholder="Filter databases"
				/>
			</div>
			<ScrollArea class="mt-2 min-h-0 flex-1" orientation="vertical" type="auto">
				<div class="space-y-1">
					{#each visibleDatabases as database (database.name)}
						<div class="group/database-row relative">
							<button
								type="button"
								class="hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-9 pl-2 text-left outline-none focus-visible:ring-2"
								class:bg-accent={database.name === activeDatabase?.name}
								onclick={() => selectDatabase(database.name)}
							>
								<DatabaseIcon class="text-muted-foreground size-4 shrink-0" />
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium">
										{database.prettyName ?? database.name}
									</span>
									{#if database.prettyName && database.prettyName !== database.name}
										<span class="text-muted-foreground block truncate font-mono text-[10px]">
											{database.name}
										</span>
									{/if}
									<span class="text-muted-foreground block text-xs">
										{database.tables.length}
										{database.tables.length === 1 ? 'table' : 'tables'}
									</span>
								</span>
							</button>
							<DatabaseActionsMenu
								databaseName={database.name}
								renameLabel={databaseCapabilities.rename === 'display-name'
									? 'Edit display name'
									: 'Rename database'}
								renameDisabled={!databaseCapabilities.rename}
								showDrop={databaseCapabilities.drop}
								dropDisabled={!databaseCapabilities.drop || databaseEntries.length <= 1}
								dropDisabledReason="A cluster must keep at least one database"
								disabled={isBusy}
								onaction={(action) => openDatabaseDialog(action, database)}
							/>
						</div>
					{:else}
						<p class="text-muted-foreground px-2 py-3 text-xs">No databases found.</p>
					{/each}
				</div>
			</ScrollArea>
		</div>
	</aside>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col">
		{#if activeDatabase}
			{#if isMockCluster || isEmulatedCluster || isLogAnalyticsCluster}
				<p class="text-muted-foreground shrink-0 border-b bg-muted/20 px-4 py-2 text-xs">
					{isLogAnalyticsCluster
						? 'Log Analytics workspace schema is read-only. Use Query Explorer to run KQL.'
						: isEmulatedCluster
							? 'Changes execute against this connection’s browser DuckDB database.'
							: 'Mock changes update this browser-local schema only; no backend data is created.'}
				</p>
			{/if}
			{#if mutationState.mutationSuccess}
				<p
					class="border-primary/20 bg-primary/5 text-foreground shrink-0 border-b px-4 py-2 text-xs"
					role="status"
				>
					{mutationState.mutationSuccess}
				</p>
			{/if}
			<DatabaseSchema
				class="min-h-0 flex-1 !rounded-none !border-0 !shadow-none"
				database={activeDatabase}
				{expansionState}
				{onexpansionchange}
				height="100%"
				headerActions={schemaActions}
				{tableActions}
				{columnActions}
			/>
		{:else if isLoading}
			<section class="min-h-0 flex-1 p-4" aria-label="Loading cluster schema">
				<div class="space-y-3">
					<Skeleton class="h-9 w-full" />
					<Skeleton class="h-36 w-full" />
				</div>
			</section>
		{:else}
			<section
				class="text-muted-foreground grid min-h-0 flex-1 place-items-center p-6 text-center text-sm"
			>
				<div>
					<TablePropertiesIcon class="mx-auto mb-3 size-6" />
					<p class="font-medium text-foreground">No database schema available</p>
					<p class="mt-1">Connect to a cluster to browse its databases and tables.</p>
				</div>
			</section>
		{/if}
	</div>
</section>

<DatabaseMutationWorkspace
	workspace={mutationWorkspace}
	{databases}
	{clusterName}
	clusterKind={isMockCluster ? 'mock' : isEmulatedCluster ? 'emulated' : 'remote'}
	renameMode={databaseCapabilities.rename || 'canonical'}
/>
