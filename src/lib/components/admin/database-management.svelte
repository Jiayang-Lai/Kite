<script lang="ts">
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import FileCode2Icon from '@lucide/svelte/icons/file-code-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import TablePropertiesIcon from '@lucide/svelte/icons/table-properties';
	import { onDestroy, tick } from 'svelte';

	import ColumnActionsMenu from '$lib/components/admin/column-actions-menu.svelte';
	import ColumnMutationDialog, {
		type ColumnMutationAction
	} from '$lib/components/admin/column-mutation-dialog.svelte';
	import ColumnOrderDialog from '$lib/components/admin/column-order-dialog.svelte';
	import CreateTableDialog from '$lib/components/admin/create-table-dialog.svelte';
	import TableEditorDialog from '$lib/components/admin/table-editor-dialog.svelte';
	import type {
		ExplorerExpansionChange,
		ExplorerExpansionState
	} from '$lib/cluster/cluster-session.svelte';
	import DatabaseSchema from '$lib/components/cluster/database-schema.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import {
		getKustoErrorMessage,
		startKustoManagementCommand,
		startKustoReadOnlyManagementCommandBatch
	} from '$lib/kusto/query-client';
	import {
		buildTablePreflightCommands,
		compareTableSnapshots,
		parseTablePreflightResults,
		snapshotLoadedTable,
		type CreateTablePlan,
		type TableMutationPlan,
		type TableSchemaSnapshot
	} from '$lib/kusto/table-management';
	import type { KustoColumn, KustoDatabaseSchema, KustoTable } from '$lib/types/kusto-schema';

	type DatabaseManagementProps = {
		databases?: KustoDatabaseSchema;
		selectedDatabase?: string;
		selectedTable?: string;
		selectedFunction?: string;
		expansionState: ExplorerExpansionState;
		onexpansionchange: (change: ExplorerExpansionChange) => void;
		clusterId: string;
		clusterUrl: string;
		clusterName: string;
		isMockCluster?: boolean;
		isLoading?: boolean;
		onopenquery?: () => void;
		onrefreshschema?: (clusterId: string) => Promise<void> | void;
		onmutationstatechange?: (running: boolean) => void;
	};

	let {
		databases,
		selectedDatabase = $bindable(),
		selectedTable = $bindable(),
		selectedFunction = $bindable(),
		expansionState,
		onexpansionchange,
		clusterId,
		clusterUrl,
		clusterName,
		isMockCluster = false,
		isLoading = false,
		onopenquery,
		onrefreshschema,
		onmutationstatechange
	}: DatabaseManagementProps = $props();

	let databaseFilter = $state('');
	let editorOpen = $state(false);
	let columnEditorOpen = $state(false);
	let columnOrderOpen = $state(false);
	let createTableOpen = $state(false);
	let columnMutationAction = $state<ColumnMutationAction>();
	let editorTable = $state.raw<KustoTable>();
	let editorColumn = $state.raw<KustoColumn>();
	let editorDatabaseName = $state('');
	let editorClusterId = $state('');
	let editorSnapshot = $state.raw<TableSchemaSnapshot>();
	let mutationError = $state('');
	let mutationSuccess = $state('');
	let isPreparingEditor = $state(false);
	let isMutating = $state(false);
	let isCreatingTable = $state(false);
	let createTableError = $state('');
	let activeCancel: (() => void) | undefined;
	let mutationRequestId = 0;
	let wasMutationDialogOpen = false;
	const isBusy = $derived(isPreparingEditor || isMutating || isCreatingTable);
	const isMutationDialogOpen = $derived(
		editorOpen || columnEditorOpen || columnOrderOpen || createTableOpen
	);
	const databaseEntries = $derived(Object.values(databases ?? {}));
	const visibleDatabases = $derived(
		databaseEntries.filter((database) =>
			database.name.toLowerCase().includes(databaseFilter.trim().toLowerCase())
		)
	);
	const activeDatabase = $derived(
		selectedDatabase ? databases?.[selectedDatabase] : databaseEntries[0]
	);

	$effect(() => {
		const firstDatabase = databaseEntries[0];
		if (firstDatabase && !databases?.[selectedDatabase ?? '']) {
			selectedDatabase = firstDatabase.name;
			selectedTable = undefined;
			selectedFunction = undefined;
		}
	});

	$effect(() => {
		const isOpen = isMutationDialogOpen;
		if (wasMutationDialogOpen && !isOpen && isBusy) cancelActiveOperation();
		wasMutationDialogOpen = isOpen;
	});

	$effect(() => {
		if (isMutationDialogOpen && editorClusterId && editorClusterId !== clusterId) {
			editorOpen = false;
			columnEditorOpen = false;
			columnOrderOpen = false;
			createTableOpen = false;
			editorTable = undefined;
			editorColumn = undefined;
		}
	});

	function selectDatabase(databaseName: string) {
		if (databaseName === selectedDatabase) return;
		if (isBusy) return;
		editorOpen = false;
		columnEditorOpen = false;
		columnOrderOpen = false;
		createTableOpen = false;
		selectedDatabase = databaseName;
		selectedTable = undefined;
		selectedFunction = undefined;
	}

	function openTableEditor(table: KustoTable) {
		if (!activeDatabase || isMockCluster || isBusy) return;
		const canonicalTable = activeDatabase.tables.find((item) => item.name === table.name);
		if (!canonicalTable) return;

		editorTable = canonicalTable;
		editorColumn = undefined;
		editorDatabaseName = activeDatabase.name;
		editorClusterId = clusterId;
		editorSnapshot = undefined;
		mutationError = '';
		mutationSuccess = '';
		createTableOpen = false;
		columnEditorOpen = false;
		columnOrderOpen = false;
		editorOpen = true;
		void prepareTableEditor(canonicalTable, activeDatabase.name);
	}

	function openColumnEditor(table: KustoTable, column: KustoColumn, action: ColumnMutationAction) {
		if (!activeDatabase || isMockCluster || isBusy) return;
		const canonicalTable = activeDatabase.tables.find((item) => item.name === table.name);
		const canonicalColumn = canonicalTable?.columns.find((item) => item.name === column.name);
		if (!canonicalTable || !canonicalColumn) return;

		editorTable = canonicalTable;
		editorColumn = canonicalColumn;
		columnMutationAction = action;
		editorDatabaseName = activeDatabase.name;
		editorClusterId = clusterId;
		editorSnapshot = undefined;
		mutationError = '';
		mutationSuccess = '';
		createTableOpen = false;
		editorOpen = false;
		columnOrderOpen = false;
		columnEditorOpen = true;
		void prepareTableEditor(canonicalTable, activeDatabase.name);
	}

	function openColumnOrderEditor(table: KustoTable) {
		if (!activeDatabase || isMockCluster || isBusy) return;
		const canonicalTable = activeDatabase.tables.find((item) => item.name === table.name);
		if (!canonicalTable) return;

		editorTable = canonicalTable;
		editorColumn = undefined;
		editorDatabaseName = activeDatabase.name;
		editorClusterId = clusterId;
		editorSnapshot = undefined;
		mutationError = '';
		mutationSuccess = '';
		createTableOpen = false;
		editorOpen = false;
		columnEditorOpen = false;
		columnOrderOpen = true;
		void prepareTableEditor(canonicalTable, activeDatabase.name);
	}

	function openCreateTableDialog() {
		if (!activeDatabase || isMockCluster || isBusy) return;
		editorDatabaseName = activeDatabase.name;
		editorClusterId = clusterId;
		editorTable = undefined;
		editorColumn = undefined;
		editorSnapshot = undefined;
		mutationError = '';
		createTableError = '';
		mutationSuccess = '';
		editorOpen = false;
		columnEditorOpen = false;
		columnOrderOpen = false;
		createTableOpen = true;
	}

	async function prepareTableEditor(table: KustoTable, databaseName: string) {
		const requestId = ++mutationRequestId;
		const targetClusterId = clusterId;
		const targetClusterUrl = clusterUrl;
		const loadedSnapshot = snapshotLoadedTable(databaseName, table);
		let closeAfterRefresh = false;

		isPreparingEditor = true;
		onmutationstatechange?.(true);
		try {
			const execution = startKustoReadOnlyManagementCommandBatch(
				databaseName,
				buildTablePreflightCommands(table.name),
				targetClusterUrl
			);
			activeCancel = execution.cancel;
			const results = await execution.promise;
			if (requestId !== mutationRequestId) return;

			const currentSnapshot = parseTablePreflightResults(results);
			const conflicts = compareTableSnapshots(loadedSnapshot, currentSnapshot);
			if (conflicts.length) {
				await onrefreshschema?.(targetClusterId);
				if (requestId !== mutationRequestId) return;
				mutationSuccess =
					'The table changed after the schema was loaded. Kite refreshed the schema; reopen the editor to continue.';
				closeAfterRefresh = true;
				return;
			}
			editorSnapshot = currentSnapshot;
		} catch (error) {
			if (requestId !== mutationRequestId) return;
			const message = getKustoErrorMessage(error);
			if (message !== 'Command cancelled.') {
				mutationError = `Kite could not verify the current table schema. The update is disabled until verification succeeds.\n\n${message}`;
			}
		} finally {
			if (requestId === mutationRequestId) {
				activeCancel = undefined;
				isPreparingEditor = false;
				onmutationstatechange?.(false);
				if (closeAfterRefresh) {
					editorOpen = false;
					columnEditorOpen = false;
					columnOrderOpen = false;
				}
			}
		}
	}

	async function updateTable(plan: TableMutationPlan) {
		if (!editorTable || !editorDatabaseName || !editorSnapshot || isMockCluster || isBusy) {
			return;
		}

		const requestId = ++mutationRequestId;
		const targetClusterId = clusterId;
		const targetClusterUrl = clusterUrl;
		const targetDatabase = editorDatabaseName;
		const targetTable = editorTable.name;
		const originalSnapshot = editorSnapshot;
		let commandCompleted = false;
		let succeeded = false;

		mutationError = '';
		mutationSuccess = '';
		isMutating = true;
		onmutationstatechange?.(true);
		try {
			const preflight = startKustoReadOnlyManagementCommandBatch(
				targetDatabase,
				buildTablePreflightCommands(targetTable),
				targetClusterUrl
			);
			activeCancel = preflight.cancel;
			const preflightResults = await preflight.promise;
			if (requestId !== mutationRequestId) return;

			const currentSnapshot = parseTablePreflightResults(preflightResults);
			const conflicts = compareTableSnapshots(originalSnapshot, currentSnapshot);
			if (conflicts.length) {
				editorSnapshot = undefined;
				mutationError = `Update blocked because the table changed while this editor was open:\n\n${conflicts.map((conflict) => `• ${conflict.message}`).join('\n')}\n\nClose and reopen the editor to review the latest schema.`;
				try {
					await onrefreshschema?.(targetClusterId);
				} catch (error) {
					mutationError += `\n\nKite also could not refresh the schema:\n${getKustoErrorMessage(error)}`;
				}
				return;
			}

			const execution = startKustoManagementCommand(targetDatabase, plan.command, targetClusterUrl);
			activeCancel = execution.cancel;
			await execution.promise;
			if (requestId !== mutationRequestId) return;
			commandCompleted = true;

			await onrefreshschema?.(targetClusterId);
			if (requestId !== mutationRequestId) return;

			mutationSuccess = `${targetDatabase}.${targetTable}: ${plan.summary}.`;
			succeeded = true;
		} catch (error) {
			if (requestId !== mutationRequestId) return;
			const message = getKustoErrorMessage(error);
			mutationError = commandCompleted
				? `The table update completed, but Kite could not refresh the schema. Reconnect or refresh before making another change.\n\n${message}`
				: message === 'Command cancelled.'
					? 'Stopped waiting for the update. The Kusto operation may still complete; refresh the schema before retrying.'
					: message;
		} finally {
			if (requestId === mutationRequestId) {
				activeCancel = undefined;
				isMutating = false;
				onmutationstatechange?.(false);
				if (succeeded) {
					editorOpen = false;
					columnEditorOpen = false;
					columnOrderOpen = false;
				}
			}
		}
	}

	async function createTable(plan: CreateTablePlan) {
		if (!editorDatabaseName || isMockCluster || isBusy) return;

		const requestId = ++mutationRequestId;
		const targetClusterId = clusterId;
		const targetClusterUrl = clusterUrl;
		const targetDatabase = editorDatabaseName;
		let commandCompleted = false;
		let succeeded = false;

		createTableError = '';
		mutationSuccess = '';
		isCreatingTable = true;
		onmutationstatechange?.(true);
		try {
			await onrefreshschema?.(targetClusterId);
			await tick();
			if (requestId !== mutationRequestId) return;

			const refreshedDatabase = databases?.[targetDatabase];
			if (
				refreshedDatabase?.tables.some(
					(table) => table.name.toLowerCase() === plan.tableName.toLowerCase()
				)
			) {
				createTableError = `Creation blocked because “${plan.tableName}” now exists in ${targetDatabase}. Choose another name.`;
				return;
			}

			const execution = startKustoManagementCommand(targetDatabase, plan.command, targetClusterUrl);
			activeCancel = execution.cancel;
			await execution.promise;
			if (requestId !== mutationRequestId) return;
			commandCompleted = true;

			await onrefreshschema?.(targetClusterId);
			await tick();
			if (requestId !== mutationRequestId) return;

			const createdTable = databases?.[targetDatabase]?.tables.find(
				(table) => table.name === plan.tableName
			);
			const schemaMatches =
				createdTable?.columns.length === plan.columns.length &&
				createdTable.columns.every(
					(column, index) =>
						column.name === plan.columns[index].name && column.type === plan.columns[index].type
				);
			if (!createdTable || !schemaMatches || (createdTable.docstring ?? '') !== plan.docstring) {
				createTableError = `The create command completed, but ${targetDatabase}.${plan.tableName} does not match the reviewed schema and description. Another client may have claimed this name; Kite did not replace that table.`;
				return;
			}

			selectedDatabase = targetDatabase;
			selectedTable = plan.tableName;
			selectedFunction = undefined;
			mutationSuccess = `${targetDatabase}.${plan.tableName}: ${plan.summary}.`;
			succeeded = true;
		} catch (error) {
			if (requestId !== mutationRequestId) return;
			const message = getKustoErrorMessage(error);
			createTableError = commandCompleted
				? `The create command completed, but Kite could not refresh and verify the table. Reconnect or refresh before continuing.\n\n${message}`
				: message === 'Command cancelled.'
					? 'Stopped waiting for creation. The Kusto operation may still complete; refresh the schema before retrying.'
					: message;
		} finally {
			if (requestId === mutationRequestId) {
				activeCancel = undefined;
				isCreatingTable = false;
				onmutationstatechange?.(false);
				if (succeeded) createTableOpen = false;
			}
		}
	}

	function cancelActiveOperation() {
		activeCancel?.();
	}

	onDestroy(() => {
		mutationRequestId += 1;
		activeCancel?.();
		onmutationstatechange?.(false);
	});
</script>

{#snippet schemaActions()}
	<Button
		size="sm"
		variant="outline"
		disabled={isMockCluster || isBusy}
		onclick={openCreateTableDialog}
		title={isMockCluster
			? 'The Mock cluster is read-only'
			: `Create a table in ${activeDatabase?.name}`}
	>
		<PlusIcon />
		New table
	</Button>
	<Button size="sm" variant="outline" onclick={() => onopenquery?.()}>
		<FileCode2Icon />
		Open in Query
	</Button>
{/snippet}

{#snippet tableActions(table: KustoTable)}
	<div class="flex items-center gap-1">
		<Button
			size="xs"
			variant="outline"
			disabled={isMockCluster || isBusy}
			onclick={() => openTableEditor(table)}
			title={isMockCluster
				? 'The Mock cluster is read-only'
				: `Edit ${table.name} without replacing existing columns`}
		>
			<PencilIcon />
			Edit table
		</Button>
		<Button
			size="xs"
			variant="outline"
			disabled={isMockCluster || isBusy}
			onclick={() => openColumnOrderEditor(table)}
			title={isMockCluster
				? 'The Mock cluster is read-only'
				: `Change the column order for ${table.name}`}
		>
			<TablePropertiesIcon />
			Reorder columns
		</Button>
	</div>
{/snippet}

{#snippet columnActions(table: KustoTable, column: KustoColumn)}
	{@const canonicalTable =
		activeDatabase?.tables.find((candidate) => candidate.name === table.name) ?? table}
	{@const canonicalColumn =
		canonicalTable.columns.find((candidate) => candidate.name === column.name) ?? column}
	<ColumnActionsMenu
		table={canonicalTable}
		column={canonicalColumn}
		disabled={isMockCluster || isBusy}
		onaction={(action) => openColumnEditor(canonicalTable, canonicalColumn, action)}
	/>
{/snippet}

<section class="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
	<Card.Root size="sm" class="h-52 shrink-0 lg:h-auto lg:w-72">
		<Card.Header>
			<Card.Title>Databases</Card.Title>
			<Card.Description>{databaseEntries.length} on the selected cluster</Card.Description>
		</Card.Header>
		<Card.Content class="min-h-0 flex flex-1 flex-col">
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
						<button
							type="button"
							class="hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2"
							class:bg-accent={database.name === activeDatabase?.name}
							onclick={() => selectDatabase(database.name)}
						>
							<DatabaseIcon class="text-muted-foreground size-4 shrink-0" />
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium">{database.name}</span>
								<span class="text-muted-foreground block text-xs">
									{database.tables.length}
									{database.tables.length === 1 ? 'table' : 'tables'}
								</span>
							</span>
						</button>
					{:else}
						<p class="text-muted-foreground px-2 py-3 text-xs">No databases found.</p>
					{/each}
				</div>
			</ScrollArea>
		</Card.Content>
	</Card.Root>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
		{#if activeDatabase}
			{#if isMockCluster}
				<p class="text-muted-foreground rounded-lg border bg-muted/20 px-3 py-2 text-xs">
					The Mock cluster is schema-only. Select a connected cluster to update tables.
				</p>
			{:else if mutationSuccess}
				<p
					class="border-primary/20 bg-primary/5 text-foreground rounded-lg border px-3 py-2 text-xs"
					role="status"
				>
					{mutationSuccess}
				</p>
			{/if}
			<DatabaseSchema
				class="min-h-0 flex-1"
				database={activeDatabase}
				{expansionState}
				{onexpansionchange}
				bind:selectedTable
				bind:selectedFunction
				height="100%"
				headerActions={schemaActions}
				{tableActions}
				{columnActions}
			/>
		{:else if isLoading}
			<Card.Root class="min-h-0 flex-1">
				<Card.Header>
					<Card.Title>Loading cluster schema</Card.Title>
					<Card.Description>Retrieving the databases and tables for this cluster.</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-3">
					<Skeleton class="h-9 w-full" />
					<Skeleton class="h-36 w-full" />
				</Card.Content>
			</Card.Root>
		{:else}
			<Card.Root class="min-h-0 flex-1">
				<Card.Content
					class="text-muted-foreground grid h-full place-items-center text-center text-sm"
				>
					<div>
						<TablePropertiesIcon class="mx-auto mb-3 size-6" />
						<p class="font-medium text-foreground">No database schema available</p>
						<p class="mt-1">Connect to a cluster to browse its databases and tables.</p>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	</div>
</section>

{#if editorDatabaseName}
	<CreateTableDialog
		bind:open={createTableOpen}
		databaseName={editorDatabaseName}
		{clusterName}
		existingTableNames={databases?.[editorDatabaseName]?.tables.map((table) => table.name) ?? []}
		isRunning={isCreatingTable}
		executionError={createTableError}
		onsubmit={createTable}
		oncancel={cancelActiveOperation}
	/>
{/if}

{#if editorTable}
	<TableEditorDialog
		bind:open={editorOpen}
		table={editorTable}
		databaseName={editorDatabaseName}
		{clusterName}
		isPreparing={isPreparingEditor}
		isRunning={isMutating}
		preflightReady={Boolean(editorSnapshot)}
		snapshot={editorSnapshot}
		executionError={mutationError}
		onsubmit={updateTable}
		oncancel={cancelActiveOperation}
	/>
{/if}

{#if editorTable}
	<ColumnOrderDialog
		bind:open={columnOrderOpen}
		table={editorTable}
		databaseName={editorDatabaseName}
		{clusterName}
		isPreparing={isPreparingEditor}
		isRunning={isMutating}
		preflightReady={Boolean(editorSnapshot)}
		snapshot={editorSnapshot}
		executionError={mutationError}
		onsubmit={updateTable}
		oncancel={cancelActiveOperation}
	/>
{/if}

{#if editorTable && editorColumn && columnMutationAction}
	<ColumnMutationDialog
		bind:open={columnEditorOpen}
		action={columnMutationAction}
		table={editorTable}
		column={editorColumn}
		databaseName={editorDatabaseName}
		{clusterName}
		isPreparing={isPreparingEditor}
		isRunning={isMutating}
		preflightReady={Boolean(editorSnapshot)}
		snapshot={editorSnapshot}
		executionError={mutationError}
		onsubmit={updateTable}
		oncancel={cancelActiveOperation}
	/>
{/if}
