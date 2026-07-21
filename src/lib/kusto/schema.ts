import type { KustoDatabase, KustoDatabaseSchema } from '$lib/types/kusto-schema';
import type { Database, EngineSchema } from '@kusto/monaco-kusto';

/**
 * Converts Kite's compact database description into the metadata shape accepted by
 * Monaco-Kusto's worker. The worker receives the complete cluster catalog for
 * cross-database completion, plus the selected database as its active context.
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

	return {
		clusterType: 'Engine',
		cluster: {
			connectionString: clusterUrl,
			databases: Object.values(schema).map(toDatabaseMetadata)
		},
		database: toDatabaseMetadata(activeDatabase)
	};
}
