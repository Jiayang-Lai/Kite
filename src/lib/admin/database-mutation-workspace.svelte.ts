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
import { getKustoErrorMessage } from '$lib/kusto/query-client';
import {
	snapshotLoadedTable,
	type CreateTablePlan,
	type TableMutationPlan
} from '$lib/kusto/table-management';
import { tick } from 'svelte';

export type DatabaseMutationWorkspaceState = {
	editorOpen: boolean;
	columnEditorOpen: boolean;
	columnOrderOpen: boolean;
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
	isPreparingEditor: boolean;
	isMutating: boolean;
	isCreatingTable: boolean;
	isDatabaseMutating: boolean;
	isDroppingTable: boolean;
	wasDialogOpen: boolean;
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
		columnOrderOpen: false,
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
		createTableError: '',
		isPreparingEditor: false,
		isMutating: false,
		isCreatingTable: false,
		isDatabaseMutating: false,
		isDroppingTable: false,
		wasDialogOpen: false
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
		state.createTableOpen = state.columnEditorOpen = state.columnOrderOpen = false;
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
		state.createTableOpen = state.editorOpen = state.columnOrderOpen = false;
		state.columnEditorOpen = true;
		void prepareTableEditor(canonical, database.name);
	}

	function openColumnOrderEditor(table: KustoTable) {
		const { database, clusterId } = currentTarget();
		const canonical = database?.tables.find((item) => item.name === table.name);
		if (!database || !canonical) return;
		state.editorTable = canonical;
		state.editorColumn = undefined;
		state.editorDatabaseName = database.name;
		state.editorClusterId = clusterId;
		resetEditorTarget();
		state.createTableOpen = state.editorOpen = state.columnEditorOpen = false;
		state.columnOrderOpen = true;
		void prepareTableEditor(canonical, database.name);
	}

	function openCreateTable() {
		const { database, clusterId, cluster } = currentTarget();
		if (!database) return;
		state.editorDatabaseName = database.name;
		state.editorClusterId = clusterId;
		state.editorTable = state.editorColumn = state.editorSnapshot = undefined;
		state.mutationError = state.createTableError = state.mutationSuccess = '';
		state.editorOpen = state.columnEditorOpen = state.columnOrderOpen = false;
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
		const requestId = current.controller.begin();
		const clusterId = current.options.getClusterId();
		state.isPreparingEditor = true;
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
			const message = getKustoErrorMessage(error);
			if (message !== 'Command cancelled.')
				state.mutationError = `Kite could not verify the current table schema. The update is disabled until verification succeeds.\n\n${message}`;
		} finally {
			if (current.controller.finish(requestId)) {
				state.isPreparingEditor = false;
				if (closeAfterRefresh) {
					state.editorOpen = false;
					state.columnEditorOpen = false;
					state.columnOrderOpen = false;
				}
			}
		}
	}

	async function updateTable(plan: TableMutationPlan) {
		if (!state.editorTable || !state.editorDatabaseName || !state.editorSnapshot) return;
		const current = requiredOptions();
		const requestId = current.controller.begin();
		const clusterId = current.options.getClusterId();
		const database = state.editorDatabaseName;
		const table = state.editorTable.name;
		state.isMutating = true;
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
			state.editorOpen = state.columnEditorOpen = state.columnOrderOpen = false;
		} catch (error) {
			if (current.controller.isCurrent(requestId))
				state.mutationError = getKustoErrorMessage(error);
		} finally {
			if (current.controller.finish(requestId)) state.isMutating = false;
		}
	}

	async function createTable(plan: CreateTablePlan) {
		if (!state.editorDatabaseName) return;
		const current = requiredOptions();
		const requestId = current.controller.begin();
		const clusterId = current.options.getClusterId();
		const database = state.editorDatabaseName;
		state.isCreatingTable = true;
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
			if (current.controller.isCurrent(requestId))
				state.createTableError = getKustoErrorMessage(error);
		} finally {
			if (current.controller.finish(requestId)) state.isCreatingTable = false;
		}
	}

	async function removeTable() {
		if (!state.tableDropSnapshot || state.isDroppingTable) return;
		const current = requiredOptions();
		const requestId = current.controller.begin();
		const clusterId = current.options.getClusterId();
		state.isDroppingTable = true;
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
			throw new Error(getKustoErrorMessage(error));
		} finally {
			if (current.controller.finish(requestId)) state.isDroppingTable = false;
		}
	}

	async function mutateDatabase(request: DatabaseMutationRequest) {
		const current = requiredOptions();
		const requestId = current.controller.begin();
		const clusterId = current.options.getClusterId();
		const cluster = current.options.store.clusters.find((item) => item.id === clusterId);
		if (!cluster) throw new Error('This cluster no longer exists.');
		const target = state.databaseDialogTarget;
		const action = state.databaseDialogAction;
		const name = request.name?.trim() ?? '';
		state.isDatabaseMutating = true;
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
			throw new Error(getKustoErrorMessage(error));
		} finally {
			if (current.controller.finish(requestId)) state.isDatabaseMutating = false;
		}
	}

	return {
		state,
		prepareTableEditor,
		openTableEditor,
		openColumnEditor,
		openColumnOrderEditor,
		openCreateTable,
		openDatabaseDialog,
		openDropTable,
		updateTable,
		createTable,
		removeTable,
		mutateDatabase,
		cancel: () => controller?.cancel(),
		dispose: () => controller?.dispose(),
		get isBusy() {
			return (
				state.isPreparingEditor ||
				state.isMutating ||
				state.isCreatingTable ||
				state.isDatabaseMutating ||
				state.isDroppingTable
			);
		},
		get isDialogOpen() {
			return (
				state.editorOpen ||
				state.columnEditorOpen ||
				state.columnOrderOpen ||
				state.createTableOpen ||
				state.databaseDialogOpen ||
				state.tableDropOpen
			);
		},
		closeEditors() {
			state.editorOpen = false;
			state.columnEditorOpen = false;
			state.columnOrderOpen = false;
			state.createTableOpen = false;
		},
		closeAll() {
			state.editorOpen = false;
			state.columnEditorOpen = false;
			state.columnOrderOpen = false;
			state.createTableOpen = false;
			state.databaseDialogOpen = false;
			state.tableDropOpen = false;
			state.editorTable = undefined;
			state.editorColumn = undefined;
		}
	};
}
