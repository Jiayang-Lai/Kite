import type { ClusterConnectionStore } from '$lib/cluster/cluster-connection-store.svelte';
import {
	applyMockCreateDatabase,
	applyMockCreateTable,
	applyMockDropDatabase,
	applyMockDropTable,
	applyMockRenameDatabase,
	applyMockTableMutation
} from '$lib/cluster/mock-schema-management';
import {
	createEmulatedDatabase,
	createEmulatedTable,
	dropEmulatedDatabase,
	dropEmulatedTable,
	mutateEmulatedTable
} from '$lib/emulation/schema-management';
import { quoteKustoEntity, quoteKustoString } from '$lib/kusto/command-format';
import {
	startKustoManagementCommand,
	startKustoReadOnlyManagementCommandBatch,
	type KustoClusterConnection
} from '$lib/kusto/query-client';
import {
	buildDropTableCommand,
	buildTablePreflightCommands,
	compareTableSnapshots,
	parseTablePreflightResults,
	type CreateTablePlan,
	type TableMutationPlan,
	type TableSchemaSnapshot,
	type TableSnapshotConflict
} from '$lib/kusto/table-management';
import type { CancellableExecution } from '$lib/types/query-result';

type DatabaseMutationAction = 'create' | 'rename' | 'drop';
type MockSchemaStore = Pick<ClusterConnectionStore, 'updateMockSchema'>;

type ExecutionStarters = {
	startManagementCommand: typeof startKustoManagementCommand;
	startReadOnlyBatch: typeof startKustoReadOnlyManagementCommandBatch;
};

type AdapterOptions = {
	cluster: KustoClusterConnection;
	mockSchemaStore: MockSchemaStore;
	mockSchemaRevision: number;
	onexecution?: (execution: CancellableExecution<unknown>) => void;
	onstage?: (stage: 'table-created' | 'column-docstrings-applied') => void;
	executions?: ExecutionStarters;
};

export type SchemaMutationOutcome = {
	mockSchemaRevision?: number;
};

export type TableVerification =
	| { kind: 'verified'; snapshot: TableSchemaSnapshot }
	| { kind: 'conflict'; conflicts: readonly TableSnapshotConflict[] };

export type TableMutationOutcome =
	SchemaMutationOutcome | Extract<TableVerification, { kind: 'conflict' }>;

/** Selects the schema-mutation implementation for one connection. */
export function createSchemaMutationAdapter(options: AdapterOptions) {
	const executions: ExecutionStarters = options.executions ?? {
		startManagementCommand: startKustoManagementCommand,
		startReadOnlyBatch: startKustoReadOnlyManagementCommandBatch
	};

	function remember<T>(execution: CancellableExecution<T>) {
		options.onexecution?.(execution);
		return execution;
	}

	async function verifyRemoteTable(
		databaseName: string,
		expectedSnapshot: TableSchemaSnapshot
	): Promise<TableVerification> {
		const execution = remember(
			executions.startReadOnlyBatch(
				databaseName,
				buildTablePreflightCommands(expectedSnapshot.tableName),
				options.cluster.url
			)
		);
		const currentSnapshot = parseTablePreflightResults(await execution.promise);
		const conflicts = compareTableSnapshots(expectedSnapshot, currentSnapshot);
		return conflicts.length
			? { kind: 'conflict', conflicts }
			: { kind: 'verified', snapshot: currentSnapshot };
	}

	function mockMutation(
		mutation: Parameters<MockSchemaStore['updateMockSchema']>[2]
	): SchemaMutationOutcome {
		const updatedCluster = options.mockSchemaStore.updateMockSchema(
			options.cluster.id,
			options.mockSchemaRevision,
			mutation
		);
		return { mockSchemaRevision: updatedCluster.mockSchemaRevision ?? options.mockSchemaRevision };
	}

	return {
		async prepareTable(
			databaseName: string,
			loadedSnapshot: TableSchemaSnapshot
		): Promise<TableVerification> {
			if (options.cluster.kind !== 'remote') {
				return { kind: 'verified', snapshot: loadedSnapshot };
			}
			return verifyRemoteTable(databaseName, loadedSnapshot);
		},

		async dropTable(
			databaseName: string,
			tableName: string,
			expectedSnapshot: TableSchemaSnapshot
		): Promise<TableMutationOutcome> {
			switch (options.cluster.kind) {
				case 'mock':
					return mockMutation((schema) =>
						applyMockDropTable(schema, databaseName, tableName, expectedSnapshot)
					);
				case 'emulated':
					await dropEmulatedTable(options.cluster.id, databaseName, tableName, expectedSnapshot);
					return {};
				case 'remote': {
					const verification = await verifyRemoteTable(databaseName, expectedSnapshot);
					if (verification.kind === 'conflict') return verification;
					await remember(
						executions.startManagementCommand(
							databaseName,
							buildDropTableCommand(tableName),
							options.cluster.url
						)
					).promise;
					return {};
				}
				case 'log-analytics':
					throw new Error('Schema mutations are unavailable for Log Analytics connections.');
			}
		},

		async mutateTable(
			databaseName: string,
			tableName: string,
			expectedSnapshot: TableSchemaSnapshot,
			plan: TableMutationPlan
		): Promise<TableMutationOutcome> {
			switch (options.cluster.kind) {
				case 'mock':
					return mockMutation((schema) =>
						applyMockTableMutation(schema, databaseName, tableName, expectedSnapshot, plan)
					);
				case 'emulated':
					await mutateEmulatedTable(
						options.cluster.id,
						databaseName,
						tableName,
						expectedSnapshot,
						plan
					);
					return {};
				case 'remote': {
					const verification = await verifyRemoteTable(databaseName, expectedSnapshot);
					if (verification.kind === 'conflict') return verification;
					await remember(
						executions.startManagementCommand(databaseName, plan.command, options.cluster.url)
					).promise;
					return {};
				}
				case 'log-analytics':
					throw new Error('Schema mutations are unavailable for Log Analytics connections.');
			}
		},

		async createTable(databaseName: string, plan: CreateTablePlan): Promise<SchemaMutationOutcome> {
			switch (options.cluster.kind) {
				case 'mock': {
					const outcome = mockMutation((schema) =>
						applyMockCreateTable(schema, databaseName, plan)
					);
					options.onstage?.('table-created');
					if (plan.columnDocstringsCommand) options.onstage?.('column-docstrings-applied');
					return outcome;
				}
				case 'emulated':
					await createEmulatedTable(options.cluster.id, databaseName, plan);
					options.onstage?.('table-created');
					if (plan.columnDocstringsCommand) options.onstage?.('column-docstrings-applied');
					return {};
				case 'remote':
					await remember(
						executions.startManagementCommand(databaseName, plan.command, options.cluster.url)
					).promise;
					options.onstage?.('table-created');
					if (plan.columnDocstringsCommand) {
						await remember(
							executions.startManagementCommand(
								databaseName,
								plan.columnDocstringsCommand,
								options.cluster.url
							)
						).promise;
						options.onstage?.('column-docstrings-applied');
					}
					return {};
				case 'log-analytics':
					throw new Error('Schema mutations are unavailable for Log Analytics connections.');
			}
		},

		async mutateDatabase(
			action: DatabaseMutationAction,
			databaseName: string,
			requestedName: string
		): Promise<SchemaMutationOutcome> {
			switch (options.cluster.kind) {
				case 'mock':
					return mockMutation((schema) => {
						switch (action) {
							case 'create':
								return applyMockCreateDatabase(schema, requestedName);
							case 'rename':
								return applyMockRenameDatabase(schema, databaseName, requestedName);
							case 'drop':
								return applyMockDropDatabase(schema, databaseName);
						}
					});
				case 'emulated':
					if (action === 'rename') {
						throw new Error('DuckDB does not support renaming an attached database.');
					}
					if (action === 'create') await createEmulatedDatabase(options.cluster.id, requestedName);
					else await dropEmulatedDatabase(options.cluster.id, databaseName);
					return {};
				case 'remote':
					if (action !== 'rename') {
						throw new Error(
							'The local backend does not support remote database creation or deletion.'
						);
					}
					await remember(
						executions.startManagementCommand(
							databaseName,
							`.alter database ${quoteKustoEntity(databaseName)} prettyname ${quoteKustoString(requestedName)}`,
							options.cluster.url
						)
					).promise;
					return {};
				case 'log-analytics':
					throw new Error('Schema mutations are unavailable for Log Analytics connections.');
			}
		}
	};
}
