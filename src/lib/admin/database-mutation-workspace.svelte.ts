import type {
	ColumnMutationAction,
	DatabaseMutationAction,
	DatabaseMutationRequest
} from '$lib/admin/mutation-contracts';
import type { TableSchemaSnapshot } from '$lib/kusto/table-management';
import type { KustoColumn, KustoTable } from '$lib/types/kusto-schema';
import type { KustoDatabase, KustoDatabaseSchema } from '$lib/types/kusto-schema';
import type { ClusterConnectionStore } from '$lib/cluster/cluster-connection-store.svelte';
import { getConnectionCapabilities } from '$lib/cluster/connection-capabilities';
import { createDatabaseMutationController } from './database-mutation-controller.svelte';
import { PartialSchemaMutationError } from './schema-mutation-adapter';
import { getErrorMessage } from '$lib/query/error-message';
import { isOperationCancelled } from '$lib/types/query-result';
import {
	snapshotLoadedTable,
	type CreateTablePlan,
	type TableMutationPlan
} from '$lib/kusto/table-management';
import { tick } from 'svelte';

/** The request in flight; starting one supersedes any other, so at most one runs. */
export type DatabaseMutationRequestKind =
	'prepare-editor' | 'update-table' | 'create-table' | 'mutate-database' | 'drop-table';

export type DatabaseMutationWorkspaceState = {
	editorOpen: boolean;
	columnEditorOpen: boolean;
	createTableOpen: boolean;
	databaseDialogOpen: boolean;
	databaseDialogAction: DatabaseMutationAction;
	databaseDialogTarget: string;
	databaseDialogInitialName: string;
	tableDropOpen: boolean;
	tableDropDatabaseName: string;
	tableDropTableName: string;
	tableDropSnapshot?: TableSchemaSnapshot;
	columnMutationAction?: ColumnMutationAction;
	editorTable?: KustoTable;
	editorColumn?: KustoColumn;
	editorDatabaseName: string;
	editorClusterId: string;
	editorSnapshot?: TableSchemaSnapshot;
	editorMockSchemaRevision: number;
	mutationError: string;
	mutationSuccess: string;
	createTableError: string;
	running?: DatabaseMutationRequestKind;
};

type WorkspaceOptions = {
	store: ClusterConnectionStore;
	getClusterId: () => string;
	getDatabases: () => KustoDatabaseSchema | undefined;
	getActiveDatabase: () => KustoDatabase | undefined;
	setSelectedDatabase: (database: string) => void;
	onrefreshschema?: (clusterId: string) => Promise<void> | void;
	onmutationstatechange?: (running: boolean) => void;
};

/** Owns mutation dialog state and the complete mutation execution workflow. */
export function createDatabaseMutationWorkspace(options?: WorkspaceOptions) {
	const state = $state<DatabaseMutationWorkspaceState>({
		editorOpen: false,
		columnEditorOpen: false,
		createTableOpen: false,
		databaseDialogOpen: false,
		databaseDialogAction: 'create',
		databaseDialogTarget: '',
		databaseDialogInitialName: '',
		tableDropOpen: false,
		tableDropDatabaseName: '',
		tableDropTableName: '',
		editorDatabaseName: '',
		editorClusterId: '',
		editorMockSchemaRevision: 0,
		mutationError: '',
		mutationSuccess: '',
		createTableError: ''
	});
	const controller = options
		? createDatabaseMutationController({
				store: options.store,
				onmutationstatechange: options.onmutationstatechange
			})
		: undefined;

	function requiredOptions() {
		if (!options || !controller) throw new Error('Mutation workflow options are unavailable.');
		return { options, controller };
	}

	function adapter(onstage?: (stage: 'table-created' | 'column-docstrings-applied') => void) {
		const current = requiredOptions();
		return current.controller.adapter(
			current.options.getClusterId(),
			state.editorMockSchemaRevision,
			onstage
		);
	}

	function currentTarget() {
		const current = requiredOptions();
		const clusterId = current.options.getClusterId();
		const cluster = current.options.store.clusters.find((item) => item.id === clusterId);
		return { current, clusterId, cluster, database: current.options.getActiveDatabase() };
	}

	/** Starts a request of `kind`, superseding any other. */
	function begin(kind: DatabaseMutationRequestKind) {
		const requestId = requiredOptions().controller.begin();
		state.running = kind;
		return requestId;
	}

	/** Clears `running` if `requestId` is still the current request, and reports whether it was. */
	function finish(requestId: number) {
		if (!requiredOptions().controller.finish(requestId)) return false;
		state.running = undefined;
		return true;
	}

	let wasDialogOpen = false;

	function isDialogOpen() {
		return (
			state.editorOpen ||
			state.columnEditorOpen ||
			state.createTableOpen ||
			state.databaseDialogOpen ||
			state.tableDropOpen
		);
	}

	function resetEditorTarget() {
		state.editorSnapshot = undefined;
		state.mutationError = '';
		state.mutationSuccess = '';
	}

	function openTableEditor(table: KustoTable) {
		const { database, clusterId } = currentTarget();
		if (!database) return;
		const canonical = database.tables.find((item) => item.name === table.name);
		if (!canonical) return;
		state.editorTable = canonical;
		state.editorColumn = undefined;
		state.editorDatabaseName = database.name;
		state.editorClusterId = clusterId;
		resetEditorTarget();
		state.createTableOpen = state.columnEditorOpen = false;
		state.editorOpen = true;
		void prepareTableEditor(canonical, database.name);
	}

	function openColumnEditor(table: KustoTable, column: KustoColumn, action: ColumnMutationAction) {
		const { database, clusterId } = currentTarget();
		const canonical = database?.tables.find((item) => item.name === table.name);
		const canonicalColumn = canonical?.columns.find((item) => item.name === column.name);
		if (!database || !canonical || !canonicalColumn) return;
		state.editorTable = canonical;
		state.editorColumn = canonicalColumn;
		state.columnMutationAction = action;
		state.editorDatabaseName = database.name;
		state.editorClusterId = clusterId;
		resetEditorTarget();
		state.createTableOpen = state.editorOpen = false;
		state.columnEditorOpen = true;
		void prepareTableEditor(canonical, database.name);
	}

	function openCreateTable() {
		const { database, clusterId, cluster } = currentTarget();
		if (!database) return;
		state.editorDatabaseName = database.name;
		state.editorClusterId = clusterId;
		state.editorTable = state.editorColumn = state.editorSnapshot = undefined;
		state.mutationError = state.createTableError = state.mutationSuccess = '';
		state.editorOpen = state.columnEditorOpen = false;
		state.createTableOpen = true;
		state.editorMockSchemaRevision = cluster?.mockSchemaRevision ?? 0;
	}

	function openDatabaseDialog(action: DatabaseMutationAction, database?: KustoDatabase) {
		const target = currentTarget();
		const capabilities = getConnectionCapabilities(target.cluster).databases;
		const supported =
			action === 'create'
				? capabilities.create
				: action === 'rename'
					? Boolean(capabilities.rename)
					: capabilities.drop;
		if (!supported) return;
		const selected = database ?? target.database;
		state.databaseDialogAction = action;
		state.databaseDialogTarget = action === 'create' ? '' : (selected?.name ?? '');
		state.databaseDialogInitialName =
			action === 'rename'
				? (selected?.prettyName ?? selected?.name ?? '')
				: state.databaseDialogTarget;
		state.editorClusterId = target.clusterId;
		state.editorMockSchemaRevision = target.cluster?.mockSchemaRevision ?? 0;
		state.mutationError = state.mutationSuccess = '';
		state.databaseDialogOpen = true;
	}

	function openDropTable(table: KustoTable) {
		const { database, clusterId, cluster } = currentTarget();
		const canonical = database?.tables.find((item) => item.name === table.name);
		if (!database || !canonical) return;
		state.tableDropDatabaseName = database.name;
		state.tableDropTableName = canonical.name;
		state.tableDropSnapshot = snapshotLoadedTable(database.name, canonical);
		state.editorClusterId = clusterId;
		state.editorMockSchemaRevision = cluster?.mockSchemaRevision ?? 0;
		state.mutationError = state.mutationSuccess = '';
		state.tableDropOpen = true;
	}

	async function prepareTableEditor(table: KustoTable, databaseName: string) {
		const current = requiredOptions();
		const requestId = begin('prepare-editor');
		const clusterId = current.options.getClusterId();
		let closeAfterRefresh = false;
		try {
			const verification = await adapter().prepareTable(
				databaseName,
				snapshotLoadedTable(databaseName, table)
			);
			if (!current.controller.isCurrent(requestId)) return;
			if (verification.kind === 'conflict') {
				await current.options.onrefreshschema?.(clusterId);
				state.mutationSuccess =
					'The table changed after the schema was loaded. Kite refreshed the schema; reopen the editor to continue.';
				closeAfterRefresh = true;
				return;
			}
			state.editorSnapshot = verification.snapshot;
		} catch (error) {
			if (!current.controller.isCurrent(requestId)) return;
			if (!isOperationCancelled(error))
				state.mutationError = `Kite could not verify the current table schema. The update is disabled until verification succeeds.\n\n${getErrorMessage(error)}`;
		} finally {
			if (finish(requestId) && closeAfterRefresh) {
				state.editorOpen = false;
				state.columnEditorOpen = false;
			}
		}
	}

	async function updateTable(plan: TableMutationPlan) {
		if (!state.editorTable || !state.editorDatabaseName || !state.editorSnapshot) return;
		const current = requiredOptions();
		const requestId = begin('update-table');
		const clusterId = current.options.getClusterId();
		const database = state.editorDatabaseName;
		const table = state.editorTable.name;
		state.mutationError = '';
		try {
			const outcome = await adapter().mutateTable(database, table, state.editorSnapshot, plan);
			if (!current.controller.isCurrent(requestId)) return;
			if ('kind' in outcome && outcome.kind === 'conflict') {
				state.editorSnapshot = undefined;
				state.mutationError = `Update blocked because the table changed while this editor was open:\n\n${outcome.conflicts.map((conflict) => `• ${conflict.message}`).join('\n')}`;
				await current.options.onrefreshschema?.(clusterId);
				return;
			}
			if ('mockSchemaRevision' in outcome && outcome.mockSchemaRevision != null)
				state.editorMockSchemaRevision = outcome.mockSchemaRevision;
			await current.options.onrefreshschema?.(clusterId);
			if (!current.controller.isCurrent(requestId)) return;
			state.mutationSuccess = `${database}.${table}: ${plan.summary}.`;
			state.editorOpen = state.columnEditorOpen = false;
		} catch (error) {
			if (!current.controller.isCurrent(requestId)) return;
			state.mutationError = getErrorMessage(error);
			if (error instanceof PartialSchemaMutationError) {
				// Part of the change was applied, so the editor's snapshot no longer matches the table.
				state.editorSnapshot = undefined;
				try {
					await current.options.onrefreshschema?.(clusterId);
				} catch {
					// The partial-change message already explains the state; a refresh can be retried.
				}
			}
		} finally {
			finish(requestId);
		}
	}

	async function createTable(plan: CreateTablePlan) {
		if (!state.editorDatabaseName) return;
		const current = requiredOptions();
		const requestId = begin('create-table');
		const clusterId = current.options.getClusterId();
		const database = state.editorDatabaseName;
		state.createTableError = '';
		try {
			const outcome = await adapter().createTable(database, plan);
			if (!current.controller.isCurrent(requestId)) return;
			if ('mockSchemaRevision' in outcome && outcome.mockSchemaRevision != null)
				state.editorMockSchemaRevision = outcome.mockSchemaRevision;
			await current.options.onrefreshschema?.(clusterId);
			await tick();
			const created = current.options
				.getDatabases()
				?.[database]?.tables.find((table) => table.name === plan.tableName);
			if (!created)
				throw new Error(
					`The create command completed, but ${database}.${plan.tableName} was not found after refreshing the schema.`
				);
			state.mutationSuccess = `${database}.${plan.tableName}: ${plan.summary}.`;
			state.createTableOpen = false;
			current.options.setSelectedDatabase(database);
		} catch (error) {
			if (current.controller.isCurrent(requestId)) state.createTableError = getErrorMessage(error);
		} finally {
			finish(requestId);
		}
	}

	async function removeTable() {
		if (!state.tableDropSnapshot || state.running === 'drop-table') return;
		const current = requiredOptions();
		const requestId = begin('drop-table');
		const clusterId = current.options.getClusterId();
		try {
			const outcome = await adapter().dropTable(
				state.tableDropDatabaseName,
				state.tableDropTableName,
				state.tableDropSnapshot
			);
			if (!current.controller.isCurrent(requestId)) return;
			if ('kind' in outcome && outcome.kind === 'conflict')
				throw new Error(outcome.conflicts.map((conflict) => conflict.message).join('\n'));
			if ('mockSchemaRevision' in outcome && outcome.mockSchemaRevision != null)
				state.editorMockSchemaRevision = outcome.mockSchemaRevision;
			await current.options.onrefreshschema?.(clusterId);
			state.mutationSuccess = `Table ${state.tableDropDatabaseName}.${state.tableDropTableName} removed.`;
		} catch (error) {
			throw new Error(getErrorMessage(error));
		} finally {
			finish(requestId);
		}
	}

	async function mutateDatabase(request: DatabaseMutationRequest) {
		const current = requiredOptions();
		const clusterId = current.options.getClusterId();
		const cluster = current.options.store.clusters.find((item) => item.id === clusterId);
		// Check before starting the request: a request that never starts must not leave Admin busy.
		if (!cluster) throw new Error('This cluster no longer exists.');
		const requestId = begin('mutate-database');
		const target = state.databaseDialogTarget;
		const action = state.databaseDialogAction;
		const name = request.name?.trim() ?? '';
		try {
			const outcome = await adapter().mutateDatabase(action, target, name);
			if (outcome.mockSchemaRevision != null)
				state.editorMockSchemaRevision = outcome.mockSchemaRevision;
			await current.options.onrefreshschema?.(clusterId);
			await tick();
			if (!current.controller.isCurrent(requestId)) return;
			const next =
				action === 'drop'
					? (Object.keys(current.options.getDatabases() ?? {}).find((item) => item !== target) ??
						'')
					: name;
			current.options.setSelectedDatabase(next);
			state.mutationSuccess =
				action === 'create'
					? `Database ${next} created.`
					: action === 'rename'
						? `Database ${target} renamed to ${next}.`
						: `Database ${target} deleted.`;
		} catch (error) {
			throw new Error(getErrorMessage(error));
		} finally {
			finish(requestId);
		}
	}

	return {
		state,
		prepareTableEditor,
		openTableEditor,
		openColumnEditor,
		openCreateTable,
		openDatabaseDialog,
		openDropTable,
		updateTable,
		createTable,
		removeTable,
		mutateDatabase,
		cancel: () => controller?.cancel(),
		/**
		 * Cancels the running request once every mutation dialog has closed, as when the user presses
		 * Escape while it runs. Call it from an effect so it sees each change to the open dialogs.
		 */
		cancelWhenDialogsClose() {
			const isOpen = isDialogOpen();
			if (wasDialogOpen && !isOpen && state.running) controller?.cancel();
			wasDialogOpen = isOpen;
		},
		dispose: () => controller?.dispose(),
		get isBusy() {
			return state.running !== undefined;
		},
		get isDialogOpen() {
			return isDialogOpen();
		},
		closeEditors() {
			state.editorOpen = false;
			state.columnEditorOpen = false;
			state.createTableOpen = false;
		},
		closeAll() {
			state.editorOpen = false;
			state.columnEditorOpen = false;
			state.createTableOpen = false;
			state.databaseDialogOpen = false;
			state.tableDropOpen = false;
			state.editorTable = undefined;
			state.editorColumn = undefined;
		}
	};
}
