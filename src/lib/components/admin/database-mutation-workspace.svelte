<script lang="ts">
	import ColumnMutationDialog from './column-mutation-dialog.svelte';
	import ColumnOrderDialog from './column-order-dialog.svelte';
	import CreateTableDialog from './create-table-dialog.svelte';
	import DatabaseMutationDialog from './database-mutation-dialog.svelte';
	import TableDropDialog from './table-drop-dialog.svelte';
	import TableEditorDialog from './table-editor-dialog.svelte';
	import type { createDatabaseMutationWorkspace } from '$lib/admin/database-mutation-workspace.svelte';
	import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

	type Props = {
		workspace: ReturnType<typeof createDatabaseMutationWorkspace>;
		databases?: KustoDatabaseSchema;
		clusterName: string;
		clusterKind: 'mock' | 'emulated' | 'remote';
		renameMode: 'canonical' | 'display-name';
	};

	let { workspace, databases, clusterName, clusterKind, renameMode }: Props = $props();
	const state = $derived(workspace.state);
</script>

<DatabaseMutationDialog
	bind:open={state.databaseDialogOpen}
	action={state.databaseDialogAction}
	databaseName={state.databaseDialogTarget}
	initialName={state.databaseDialogInitialName}
	{clusterKind}
	{renameMode}
	onsubmit={workspace.mutateDatabase}
/>

<TableDropDialog
	bind:open={state.tableDropOpen}
	databaseName={state.tableDropDatabaseName}
	tableName={state.tableDropTableName}
	{clusterKind}
	onsubmit={workspace.removeTable}
/>

{#if state.editorDatabaseName}
	<CreateTableDialog
		bind:open={state.createTableOpen}
		databaseName={state.editorDatabaseName}
		{clusterName}
		existingTableNames={databases?.[state.editorDatabaseName]?.tables.map((table) => table.name) ??
			[]}
		isRunning={state.isCreatingTable}
		executionError={state.createTableError}
		onsubmit={workspace.createTable}
		oncancel={workspace.cancel}
	/>
{/if}

{#if state.editorTable}
	<TableEditorDialog
		bind:open={state.editorOpen}
		table={state.editorTable}
		databaseName={state.editorDatabaseName}
		{clusterName}
		isPreparing={state.isPreparingEditor}
		isRunning={state.isMutating}
		preflightReady={Boolean(state.editorSnapshot)}
		snapshot={state.editorSnapshot}
		executionError={state.mutationError}
		onsubmit={workspace.updateTable}
		oncancel={workspace.cancel}
	/>
	<ColumnOrderDialog
		bind:open={state.columnOrderOpen}
		table={state.editorTable}
		databaseName={state.editorDatabaseName}
		{clusterName}
		isPreparing={state.isPreparingEditor}
		isRunning={state.isMutating}
		preflightReady={Boolean(state.editorSnapshot)}
		snapshot={state.editorSnapshot}
		executionError={state.mutationError}
		onsubmit={workspace.updateTable}
		oncancel={workspace.cancel}
	/>
{/if}

{#if state.editorTable && state.editorColumn && state.columnMutationAction}
	<ColumnMutationDialog
		bind:open={state.columnEditorOpen}
		action={state.columnMutationAction}
		table={state.editorTable}
		column={state.editorColumn}
		databaseName={state.editorDatabaseName}
		{clusterName}
		isPreparing={state.isPreparingEditor}
		isRunning={state.isMutating}
		preflightReady={Boolean(state.editorSnapshot)}
		snapshot={state.editorSnapshot}
		executionError={state.mutationError}
		onsubmit={workspace.updateTable}
		oncancel={workspace.cancel}
	/>
{/if}
