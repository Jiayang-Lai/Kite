import {
	checkpointDuckDb,
	createDuckDbDatabase,
	dropDuckDbDatabase,
	executeDuckDbSql
} from '$lib/duckdb/lazy-client';
import { loadEmulatedSchema, quoteDuckDbIdentifier } from '$lib/emulation/cluster';
import {
	compareTableSnapshots,
	snapshotLoadedTable,
	type CreateTablePlan,
	type KustoScalarType,
	type TableMutationPlan,
	type TableSchemaSnapshot
} from '$lib/kusto/table-management';

const KUSTO_TO_DUCKDB_TYPE: Record<KustoScalarType, string> = {
	bool: 'BOOLEAN',
	datetime: 'TIMESTAMP',
	decimal: 'DECIMAL',
	dynamic: 'JSON',
	guid: 'UUID',
	int: 'INTEGER',
	long: 'BIGINT',
	real: 'DOUBLE',
	string: 'VARCHAR',
	timespan: 'INTERVAL'
};

function quoteDuckDbString(value: string) {
	return `'${value.replaceAll("'", "''")}'`;
}

function qualifiedTable(database: string, table: string) {
	return `${quoteDuckDbIdentifier(database)}.main.${quoteDuckDbIdentifier(table)}`;
}

async function runTransaction(clusterId: string, statements: readonly string[]) {
	await executeDuckDbSql('BEGIN TRANSACTION', clusterId);
	try {
		for (const statement of statements) await executeDuckDbSql(statement, clusterId);
		await executeDuckDbSql('COMMIT', clusterId);
	} catch (cause) {
		try {
			await executeDuckDbSql('ROLLBACK', clusterId);
		} catch {
			// Preserve the mutation error when rollback also fails.
		}
		throw cause;
	}
	await checkpointDuckDb(clusterId);
}

function tableCommentStatement(database: string, table: string, comment: string) {
	return `COMMENT ON TABLE ${qualifiedTable(database, table)} IS ${
		comment ? quoteDuckDbString(comment) : 'NULL'
	}`;
}

function columnCommentStatement(database: string, table: string, column: string, comment?: string) {
	if (!comment) return '';
	return `COMMENT ON COLUMN ${qualifiedTable(database, table)}.${quoteDuckDbIdentifier(column)} IS ${quoteDuckDbString(comment)}`;
}

async function assertCurrentSnapshot(clusterId: string, expectedSnapshot: TableSchemaSnapshot) {
	const schema = await loadEmulatedSchema(clusterId);
	const table = schema[expectedSnapshot.databaseName]?.tables.find(
		(candidate) => candidate.name === expectedSnapshot.tableName
	);
	if (!table) throw new Error(`Table “${expectedSnapshot.tableName}” no longer exists.`);

	const currentSnapshot = snapshotLoadedTable(expectedSnapshot.databaseName, table);
	const conflicts = compareTableSnapshots(expectedSnapshot, currentSnapshot);
	if (conflicts.length) {
		throw new Error(
			`Update blocked because the DuckDB table changed while this editor was open:\n\n${conflicts
				.map((conflict) => `• ${conflict.message}`)
				.join('\n')}`
		);
	}
}

/** Creates one attached DuckDB database using the cluster's configured storage. */
export async function createEmulatedDatabase(clusterId: string, requestedName: string) {
	const name = requestedName.trim();
	if (!name) throw new Error('Enter a database name.');
	const schema = await loadEmulatedSchema(clusterId);
	if (Object.keys(schema).some((existing) => existing.toLowerCase() === name.toLowerCase())) {
		throw new Error(`Database “${name}” already exists.`);
	}
	await createDuckDbDatabase(clusterId, name);
}

/** Removes one non-default attached DuckDB database and all data inside it. */
export async function dropEmulatedDatabase(clusterId: string, databaseName: string) {
	if (databaseName === 'memory') {
		throw new Error('DuckDB’s default memory database cannot be removed.');
	}
	const schema = await loadEmulatedSchema(clusterId);
	const fallbackDatabase = Object.keys(schema).find((name) => name !== databaseName);
	if (!fallbackDatabase) throw new Error('An emulated cluster must contain at least one database.');

	await dropDuckDbDatabase(clusterId, databaseName, fallbackDatabase);
}

/** Creates a physical DuckDB table matching a reviewed Kusto-shaped table plan. */
export async function createEmulatedTable(
	clusterId: string,
	databaseName: string,
	plan: CreateTablePlan
) {
	const columns = plan.columns
		.map((column) => `${quoteDuckDbIdentifier(column.name)} ${KUSTO_TO_DUCKDB_TYPE[column.type]}`)
		.join(', ');
	await runTransaction(clusterId, [
		`CREATE TABLE ${qualifiedTable(databaseName, plan.tableName)} (${columns})`,
		tableCommentStatement(databaseName, plan.tableName, plan.docstring),
		...plan.columns
			.map((column) =>
				columnCommentStatement(databaseName, plan.tableName, column.name, column.docstring)
			)
			.filter(Boolean)
	]);
}

/** Drops a physical DuckDB table after rechecking the schema shown to the user. */
export async function dropEmulatedTable(
	clusterId: string,
	databaseName: string,
	tableName: string,
	expectedSnapshot: TableSchemaSnapshot
) {
	await assertCurrentSnapshot(clusterId, expectedSnapshot);
	await executeDuckDbSql(`DROP TABLE ${qualifiedTable(databaseName, tableName)}`, clusterId);
	await checkpointDuckDb(clusterId);
}

/** Applies Kite's structured table plans as DuckDB DDL. */
export async function mutateEmulatedTable(
	clusterId: string,
	databaseName: string,
	tableName: string,
	expectedSnapshot: TableSchemaSnapshot,
	plan: TableMutationPlan
) {
	await assertCurrentSnapshot(clusterId, expectedSnapshot);
	const table = qualifiedTable(databaseName, tableName);
	const statements: string[] = [];

	switch (plan.kind) {
		case 'update-table':
			for (const column of plan.addedColumns) {
				statements.push(
					`ALTER TABLE ${table} ADD COLUMN ${quoteDuckDbIdentifier(column.name)} ${
						KUSTO_TO_DUCKDB_TYPE[column.type]
					}`
				);
			}
			if (plan.updatesDocstring) {
				statements.push(tableCommentStatement(databaseName, tableName, plan.nextDocstring));
			}
			break;
		case 'rename-column':
			statements.push(
				`ALTER TABLE ${table} RENAME COLUMN ${quoteDuckDbIdentifier(
					plan.columnName
				)} TO ${quoteDuckDbIdentifier(plan.newColumnName)}`
			);
			break;
		case 'drop-column':
			statements.push(`ALTER TABLE ${table} DROP COLUMN ${quoteDuckDbIdentifier(plan.columnName)}`);
			break;
		case 'change-column-type':
			statements.push(
				`ALTER TABLE ${table} ALTER COLUMN ${quoteDuckDbIdentifier(
					plan.columnName
				)} SET DATA TYPE ${KUSTO_TO_DUCKDB_TYPE[plan.newColumnType]}`
			);
			break;
		case 'reorder-table-columns': {
			const temporaryName = `__kite_reorder_${crypto.randomUUID().replaceAll('-', '')}`;
			const temporaryTable = qualifiedTable(databaseName, temporaryName);
			const selectedColumns = plan.columns
				.map((column) => quoteDuckDbIdentifier(column.name))
				.join(', ');
			statements.push(
				`CREATE TABLE ${temporaryTable} AS SELECT ${selectedColumns} FROM ${table}`,
				`DROP TABLE ${table}`,
				`ALTER TABLE ${temporaryTable} RENAME TO ${quoteDuckDbIdentifier(tableName)}`,
				tableCommentStatement(databaseName, tableName, plan.preservedDocstring)
			);
			break;
		}
	}

	await runTransaction(clusterId, statements);
}
