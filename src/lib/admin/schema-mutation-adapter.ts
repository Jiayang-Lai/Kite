import type { ClusterConnectionStore } from '$lib/cluster/cluster-connection-store.svelte';
import type {
	ClusterConnectionOfKind,
	ClusterKind,
	KustoClusterConnection
} from '$lib/cluster/connections';
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
	startKustoReadOnlyManagementCommandBatch
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

/** Uniform schema-mutation contract implemented by every cluster kind. */
export interface SchemaMutationPort {
	prepareTable(
		databaseName: string,
		loadedSnapshot: TableSchemaSnapshot
	): Promise<TableVerification>;
	dropTable(
		databaseName: string,
		tableName: string,
		expectedSnapshot: TableSchemaSnapshot
	): Promise<TableMutationOutcome>;
	mutateTable(
		databaseName: string,
		tableName: string,
		expectedSnapshot: TableSchemaSnapshot,
		plan: TableMutationPlan
	): Promise<TableMutationOutcome>;
	createTable(databaseName: string, plan: CreateTablePlan): Promise<SchemaMutationOutcome>;
	mutateDatabase(
		action: DatabaseMutationAction,
		databaseName: string,
		requestedName: string
	): Promise<SchemaMutationOutcome>;
}

type AdapterContext = {
	mockSchemaStore: MockSchemaStore;
	mockSchemaRevision: number;
	executions: ExecutionStarters;
	remember<T>(execution: CancellableExecution<T>): CancellableExecution<T>;
	stage(stage: 'table-created' | 'column-docstrings-applied'): void;
};

type SchemaMutationAdapterFactory<K extends ClusterKind> = (
	cluster: ClusterConnectionOfKind<K>,
	context: AdapterContext
) => SchemaMutationPort;

type SchemaMutationAdapterRegistry = {
	[K in ClusterKind]: SchemaMutationAdapterFactory<K>;
};

function verified(snapshot: TableSchemaSnapshot): TableVerification {
	return { kind: 'verified', snapshot };
}

function unavailable(): never {
	throw new Error('Schema mutations are unavailable for Log Analytics connections.');
}

const schemaMutationAdapterFactories = {
	mock: (cluster, context) => {
		function mutate(
			mutation: Parameters<MockSchemaStore['updateMockSchema']>[2]
		): SchemaMutationOutcome {
			const updatedCluster = context.mockSchemaStore.updateMockSchema(
				cluster.id,
				context.mockSchemaRevision,
				mutation
			);
			return {
				mockSchemaRevision: updatedCluster.mockSchemaRevision ?? context.mockSchemaRevision
			};
		}

		return {
			async prepareTable(_databaseName, loadedSnapshot) {
				return verified(loadedSnapshot);
			},
			async dropTable(databaseName, tableName, expectedSnapshot) {
				return mutate((schema) =>
					applyMockDropTable(schema, databaseName, tableName, expectedSnapshot)
				);
			},
			async mutateTable(databaseName, tableName, expectedSnapshot, plan) {
				return mutate((schema) =>
					applyMockTableMutation(schema, databaseName, tableName, expectedSnapshot, plan)
				);
			},
			async createTable(databaseName, plan) {
				const outcome = mutate((schema) => applyMockCreateTable(schema, databaseName, plan));
				context.stage('table-created');
				if (plan.columnDocstringsCommand) context.stage('column-docstrings-applied');
				return outcome;
			},
			async mutateDatabase(action, databaseName, requestedName) {
				return mutate((schema) => {
					switch (action) {
						case 'create':
							return applyMockCreateDatabase(schema, requestedName);
						case 'rename':
							return applyMockRenameDatabase(schema, databaseName, requestedName);
						case 'drop':
							return applyMockDropDatabase(schema, databaseName);
					}
				});
			}
		};
	},
	emulated: (cluster, context) => ({
		async prepareTable(_databaseName, loadedSnapshot) {
			return verified(loadedSnapshot);
		},
		async dropTable(databaseName, tableName, expectedSnapshot) {
			await dropEmulatedTable(cluster.id, databaseName, tableName, expectedSnapshot);
			return {};
		},
		async mutateTable(databaseName, tableName, expectedSnapshot, plan) {
			await mutateEmulatedTable(cluster.id, databaseName, tableName, expectedSnapshot, plan);
			return {};
		},
		async createTable(databaseName, plan) {
			await createEmulatedTable(cluster.id, databaseName, plan);
			context.stage('table-created');
			if (plan.columnDocstringsCommand) context.stage('column-docstrings-applied');
			return {};
		},
		async mutateDatabase(action, databaseName, requestedName) {
			if (action === 'rename') {
				throw new Error('DuckDB does not support renaming an attached database.');
			}
			if (action === 'create') await createEmulatedDatabase(cluster.id, requestedName);
			else await dropEmulatedDatabase(cluster.id, databaseName);
			return {};
		}
	}),
	remote: (cluster, context) => {
		async function verifyTable(
			databaseName: string,
			expectedSnapshot: TableSchemaSnapshot
		): Promise<TableVerification> {
			const execution = context.remember(
				context.executions.startReadOnlyBatch(
					databaseName,
					buildTablePreflightCommands(expectedSnapshot.tableName),
					cluster.url
				)
			);
			const currentSnapshot = parseTablePreflightResults(await execution.promise);
			const conflicts = compareTableSnapshots(expectedSnapshot, currentSnapshot);
			return conflicts.length ? { kind: 'conflict', conflicts } : verified(currentSnapshot);
		}

		return {
			prepareTable: verifyTable,
			async dropTable(databaseName, tableName, expectedSnapshot) {
				const verification = await verifyTable(databaseName, expectedSnapshot);
				if (verification.kind === 'conflict') return verification;
				await context.remember(
					context.executions.startManagementCommand(
						databaseName,
						buildDropTableCommand(tableName),
						cluster.url
					)
				).promise;
				return {};
			},
			async mutateTable(databaseName, _tableName, expectedSnapshot, plan) {
				const verification = await verifyTable(databaseName, expectedSnapshot);
				if (verification.kind === 'conflict') return verification;
				await context.remember(
					context.executions.startManagementCommand(databaseName, plan.command, cluster.url)
				).promise;
				return {};
			},
			async createTable(databaseName, plan) {
				await context.remember(
					context.executions.startManagementCommand(databaseName, plan.command, cluster.url)
				).promise;
				context.stage('table-created');
				if (plan.columnDocstringsCommand) {
					await context.remember(
						context.executions.startManagementCommand(
							databaseName,
							plan.columnDocstringsCommand,
							cluster.url
						)
					).promise;
					context.stage('column-docstrings-applied');
				}
				return {};
			},
			async mutateDatabase(action, databaseName, requestedName) {
				if (action !== 'rename') {
					throw new Error(
						'The local backend does not support remote database creation or deletion.'
					);
				}
				await context.remember(
					context.executions.startManagementCommand(
						databaseName,
						`.alter database ${quoteKustoEntity(databaseName)} prettyname ${quoteKustoString(requestedName)}`,
						cluster.url
					)
				).promise;
				return {};
			}
		};
	},
	'log-analytics': () => ({
		async prepareTable(_databaseName, loadedSnapshot) {
			return verified(loadedSnapshot);
		},
		async dropTable() {
			return unavailable();
		},
		async mutateTable() {
			return unavailable();
		},
		async createTable() {
			return unavailable();
		},
		async mutateDatabase() {
			return unavailable();
		}
	})
} satisfies SchemaMutationAdapterRegistry;

/** Selects the schema-mutation implementation for one connection. */
export function createSchemaMutationAdapter(options: AdapterOptions): SchemaMutationPort {
	const context: AdapterContext = {
		mockSchemaStore: options.mockSchemaStore,
		mockSchemaRevision: options.mockSchemaRevision,
		executions: options.executions ?? {
			startManagementCommand: startKustoManagementCommand,
			startReadOnlyBatch: startKustoReadOnlyManagementCommandBatch
		},
		remember<T>(execution: CancellableExecution<T>) {
			options.onexecution?.(execution);
			return execution;
		},
		stage(stage) {
			options.onstage?.(stage);
		}
	};
	// TypeScript cannot preserve the key/value correlation when indexing a mapped registry.
	const factory = schemaMutationAdapterFactories[options.cluster.kind] as unknown as (
		cluster: typeof options.cluster,
		context: AdapterContext
	) => SchemaMutationPort;
	return factory(options.cluster, context);
}
