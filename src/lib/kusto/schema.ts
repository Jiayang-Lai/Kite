import type { KustoDatabase, KustoDatabaseSchema } from '$lib/types/kusto-schema';
import type { Database, EngineSchema } from '@kusto/monaco-kusto';

/**
 * Converts Kite's compact database description into the metadata shape accepted by
 * Monaco-Kusto's worker. The worker receives full metadata for the selected
 * database and name-only table stubs for other databases. This avoids turning an
 * entire cluster catalog into both V1 and V2 Bridge.NET symbol graphs at once.
 */
/**
 * Returns the requested database, falling back to the first configured database.
 *
 * A fallback keeps the editor usable while a parent is switching data sources, but
 * an empty schema is invalid because Monaco-Kusto requires an active database.
 */
export function getKustoDatabase(schema: KustoDatabaseSchema, databaseName: string): KustoDatabase {
	const fallbackDatabase = Object.values(schema)[0];
	if (!fallbackDatabase) {
		throw new Error('At least one database must be provided.');
	}

	return schema[databaseName] ?? fallbackDatabase;
}

/**
 * Builds the `setSchema` payload consumed by the Monaco-Kusto worker.
 *
 * Empty metadata collections and stable version fields are supplied when omitted
 * because they are required by the language service's database contract.
 */
export function createKustoSchema(
	schema: KustoDatabaseSchema,
	databaseName: string,
	clusterUrl = 'https://help.kusto.windows.net'
): EngineSchema {
	const activeDatabase = getKustoDatabase(schema, databaseName);
	const toDatabaseMetadata = (database: KustoDatabase): Database => ({
		name: database.name,
		alternateName: database.alternateName,
		tables: database.tables,
		functions: database.functions ?? [],
		graphs: database.graphs ?? [],
		entityGroups: database.entityGroups ?? [],
		majorVersion: database.majorVersion ?? 1,
		minorVersion: database.minorVersion ?? 0
	});
	const toCatalogStub = (database: KustoDatabase): Database => ({
		name: database.name,
		alternateName: database.alternateName,
		// Keep table names for cross-database discovery, but omit their columns.
		tables: database.tables.map((table) => ({
			name: table.name,
			entityType: table.entityType,
			columns: []
		})),
		// A Monaco-Kusto function requires its body to be semantically useful. Do
		// not send misleading empty bodies for inactive databases; switching to one
		// sends its full function metadata below.
		functions: [],
		graphs: [],
		entityGroups: [],
		majorVersion: database.majorVersion ?? 1,
		minorVersion: database.minorVersion ?? 0
	});

	// Reuse the active metadata instance for both fields. Structured clone retains
	// object identity, avoiding a second copy of the active database in transit.
	const activeMetadata = toDatabaseMetadata(activeDatabase);

	return {
		clusterType: 'Engine',
		cluster: {
			connectionString: clusterUrl,
			databases: Object.values(schema).map((database) =>
				database === activeDatabase ? activeMetadata : toCatalogStub(database)
			)
		},
		database: activeMetadata
	};
}
