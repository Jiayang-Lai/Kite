import type {
	CreateTablePlan,
	TableMutationPlan,
	TableSchemaSnapshot
} from '$lib/kusto/table-management';
import { compareTableSnapshots, snapshotLoadedTable } from '$lib/kusto/table-management';
import { cloneMockSchema } from '$lib/cluster/mock-cluster-schema';
import type { KustoDatabase, KustoDatabaseSchema, KustoTable } from '$lib/types/kusto-schema';

function requireDatabase(schema: KustoDatabaseSchema, databaseName: string) {
	const database = schema[databaseName];
	if (!database) throw new Error(`Database “${databaseName}” no longer exists.`);
	return database;
}

function requireTable(database: KustoDatabase, tableName: string) {
	const table = database.tables.find((candidate) => candidate.name === tableName);
	if (!table) throw new Error(`Table “${tableName}” no longer exists.`);
	return table;
}

function assertTableSnapshot(table: KustoTable, expectedSnapshot: TableSchemaSnapshot) {
	const currentSnapshot = snapshotLoadedTable(expectedSnapshot.databaseName, table);
	const conflicts = compareTableSnapshots(expectedSnapshot, currentSnapshot);
	if (conflicts.length) {
		throw new Error(
			`Update blocked because the mock table changed while this editor was open:\n\n${conflicts
				.map((conflict) => `• ${conflict.message}`)
				.join('\n')}`
		);
	}
}

/** Adds one table to a private mock schema after rechecking its name. */
export function applyMockCreateTable(
	schema: KustoDatabaseSchema,
	databaseName: string,
	plan: CreateTablePlan
) {
	const nextSchema = cloneMockSchema(schema);
	const database = requireDatabase(nextSchema, databaseName);
	if (
		database.tables.some(
			(table) => table.name.trim().toLowerCase() === plan.tableName.trim().toLowerCase()
		)
	) {
		throw new Error(`Table “${plan.tableName}” already exists in this database.`);
	}

	nextSchema[databaseName] = {
		...database,
		tables: [
			...database.tables,
			{
				name: plan.tableName,
				columns: plan.columns.map((column) => ({ ...column })),
				docstring: plan.docstring
			}
		]
	};
	return nextSchema;
}

/** Removes one table after confirming the loaded schema still matches. */
export function applyMockDropTable(
	schema: KustoDatabaseSchema,
	databaseName: string,
	tableName: string,
	expectedSnapshot: TableSchemaSnapshot
) {
	const nextSchema = cloneMockSchema(schema);
	const database = requireDatabase(nextSchema, databaseName);
	const table = requireTable(database, tableName);
	assertTableSnapshot(table, expectedSnapshot);
	nextSchema[databaseName] = {
		...database,
		tables: database.tables.filter((candidate) => candidate.name !== tableName)
	};
	return nextSchema;
}

/** Applies the semantic portion of an existing table plan without executing Kusto. */
export function applyMockTableMutation(
	schema: KustoDatabaseSchema,
	databaseName: string,
	tableName: string,
	expectedSnapshot: TableSchemaSnapshot,
	plan: TableMutationPlan
) {
	const nextSchema = cloneMockSchema(schema);
	const database = requireDatabase(nextSchema, databaseName);
	const table = requireTable(database, tableName);
	assertTableSnapshot(table, expectedSnapshot);

	let updatedTable: KustoTable;
	switch (plan.kind) {
		case 'update-table':
			updatedTable = {
				...table,
				columns: [...table.columns, ...plan.addedColumns.map((column) => ({ ...column }))],
				docstring: plan.updatesDocstring ? plan.nextDocstring : table.docstring
			};
			break;
		case 'rename-column':
			if (!table.columns.some((column) => column.name === plan.columnName)) {
				throw new Error(`Column “${plan.columnName}” no longer exists.`);
			}
			updatedTable = {
				...table,
				columns: table.columns.map((column) =>
					column.name === plan.columnName ? { ...column, name: plan.newColumnName } : column
				)
			};
			break;
		case 'drop-column':
			updatedTable = {
				...table,
				columns: table.columns.filter((column) => column.name !== plan.columnName)
			};
			break;
		case 'change-column-type':
			if (!table.columns.some((column) => column.name === plan.columnName)) {
				throw new Error(`Column “${plan.columnName}” no longer exists.`);
			}
			updatedTable = {
				...table,
				columns: table.columns.map((column) =>
					column.name === plan.columnName ? { ...column, type: plan.newColumnType } : column
				)
			};
			break;
		case 'reorder-table-columns': {
			const columnsByName = new Map(table.columns.map((column) => [column.name, column]));
			updatedTable = {
				...table,
				columns: plan.columns.map((column) => ({
					...columnsByName.get(column.name),
					name: column.name,
					type: column.type
				})),
				docstring: plan.preservedDocstring
			};
			break;
		}
	}

	nextSchema[databaseName] = {
		...database,
		tables: database.tables.map((candidate) =>
			candidate.name === tableName ? updatedTable : candidate
		)
	};
	return nextSchema;
}

function validateDatabaseName(
	schema: KustoDatabaseSchema,
	requestedName: string,
	exceptName?: string
) {
	const name = requestedName.trim();
	if (!name) throw new Error('Enter a database name.');
	if (
		Object.keys(schema).some(
			(existingName) =>
				existingName !== exceptName && existingName.toLowerCase() === name.toLowerCase()
		)
	) {
		throw new Error(`Database “${name}” already exists.`);
	}
	return name;
}

export function applyMockCreateDatabase(
	schema: KustoDatabaseSchema,
	requestedName: string
): KustoDatabaseSchema {
	const nextSchema = cloneMockSchema(schema);
	const name = validateDatabaseName(nextSchema, requestedName);
	nextSchema[name] = { name, tables: [], functions: [] };
	return nextSchema;
}

export function applyMockRenameDatabase(
	schema: KustoDatabaseSchema,
	databaseName: string,
	requestedName: string
): KustoDatabaseSchema {
	const nextSchema = cloneMockSchema(schema);
	const database = requireDatabase(nextSchema, databaseName);
	const name = validateDatabaseName(nextSchema, requestedName, databaseName);
	if (name === databaseName) throw new Error('Enter a different database name.');

	const renamedDatabase = { ...database, name };
	const renamedSchema: KustoDatabaseSchema = {};
	for (const [key, value] of Object.entries(nextSchema)) {
		renamedSchema[key === databaseName ? name : key] =
			key === databaseName ? renamedDatabase : value;
	}
	return renamedSchema;
}

export function applyMockDropDatabase(
	schema: KustoDatabaseSchema,
	databaseName: string
): KustoDatabaseSchema {
	if (Object.keys(schema).length <= 1) {
		throw new Error('A mock cluster must contain at least one database.');
	}
	const nextSchema = cloneMockSchema(schema);
	requireDatabase(nextSchema, databaseName);
	delete nextSchema[databaseName];
	return nextSchema;
}
