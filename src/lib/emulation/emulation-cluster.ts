import {
	executeDuckDbQuery,
	executeDuckDbSql,
	getDuckDbInternalCatalogName,
	isPersistentDuckDbSession
} from '$lib/duckdb/lazy-client';
import { translateKqlToSql } from '$lib/kql/wasm-translator';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
import type { QueryExecution } from '$lib/types/query-result';

const SCHEMA_SQL = `
	SELECT
		d.database_name,
		t.schema_name,
		t.table_name,
		t.comment AS table_comment,
		c.column_name,
		c.data_type,
		c.ordinal_position
	FROM duckdb_databases() AS d
	LEFT JOIN duckdb_tables() AS t
		ON t.database_name = d.database_name
		AND t.schema_name = 'main'
		AND NOT t.internal
	LEFT JOIN information_schema.columns AS c
		ON c.table_catalog = t.database_name
		AND c.table_schema = t.schema_name
		AND c.table_name = t.table_name
	WHERE NOT d.internal
	ORDER BY d.database_name, t.table_name, c.ordinal_position
`;

const PERSISTENT_SCHEMA_SQL = `
	SELECT
		s.schema_name AS database_name,
		s.schema_name,
		t.table_name,
		t.comment AS table_comment,
		c.column_name,
		c.data_type,
		c.ordinal_position
	FROM information_schema.schemata AS s
	LEFT JOIN duckdb_tables() AS t
		ON t.database_name = current_database()
		AND t.schema_name = s.schema_name
		AND NOT t.internal
	LEFT JOIN information_schema.columns AS c
		ON c.table_catalog = current_database()
		AND c.table_schema = t.schema_name
		AND c.table_name = t.table_name
	WHERE s.catalog_name = current_database()
		AND s.schema_name NOT IN (
			'information_schema',
			'pg_catalog',
			'main',
			'kite_internal'
		)
	ORDER BY s.schema_name, t.table_name, c.ordinal_position
`;

export function quoteDuckDbIdentifier(value: string) {
	const name = value.trim();
	if (!name) throw new Error('DuckDB identifiers cannot be empty.');
	return `"${name.replaceAll('"', '""')}"`;
}

function toKustoType(type: string) {
	const normalized = type.toUpperCase();
	if (normalized === 'BOOLEAN') return 'bool';
	if (normalized === 'TINYINT' || normalized === 'SMALLINT' || normalized === 'INTEGER')
		return 'int';
	if (normalized === 'BIGINT' || normalized.startsWith('HUGEINT')) return 'long';
	if (normalized === 'FLOAT' || normalized === 'DOUBLE' || normalized === 'REAL') {
		return 'real';
	}
	if (normalized.startsWith('DECIMAL')) return 'decimal';
	if (
		normalized === 'DATE' ||
		normalized.startsWith('TIMESTAMP') ||
		normalized.startsWith('TIME')
	) {
		return 'datetime';
	}
	if (normalized === 'INTERVAL') return 'timespan';
	if (normalized === 'UUID') return 'guid';
	if (
		normalized === 'JSON' ||
		normalized.includes('[]') ||
		normalized.startsWith('LIST') ||
		normalized.startsWith('MAP') ||
		normalized.startsWith('STRUCT') ||
		normalized.startsWith('UNION')
	) {
		return 'dynamic';
	}
	return 'string';
}

/** Reads an emulated cluster's live DuckDB catalog into Monaco-Kusto's schema shape. */
export async function loadEmulatedSchema(clusterId: string): Promise<KustoDatabaseSchema> {
	const persistent = await isPersistentDuckDbSession(clusterId);
	const result = await executeDuckDbSql(persistent ? PERSISTENT_SCHEMA_SQL : SCHEMA_SQL, clusterId);
	const internalCatalogName = await getDuckDbInternalCatalogName(clusterId);
	const indexes = Object.fromEntries(result.columns.map((column, index) => [column.name, index]));
	const schema: KustoDatabaseSchema = {};
	const tables = new Map<
		string,
		{ name: string; columns: Array<{ name: string; type: string }> }
	>();

	for (const row of result.rows) {
		const databaseName = String(row[indexes.database_name]);
		if (databaseName === internalCatalogName) continue;
		const database = (schema[databaseName] ??= {
			name: databaseName,
			tables: [],
			functions: []
		});
		const tableValue = row[indexes.table_name];
		if (tableValue == null) continue;

		const tableName = String(tableValue);
		const tableKey = `${databaseName}\0${tableName}`;
		let table = tables.get(tableKey);
		if (!table) {
			table = {
				name: tableName,
				columns: []
			};
			const comment = row[indexes.table_comment];
			const schemaTable = {
				...table,
				docstring: comment == null ? undefined : String(comment)
			};
			tables.set(tableKey, schemaTable);
			(database.tables as (typeof schemaTable)[]).push(schemaTable);
			table = schemaTable;
		}

		const columnValue = row[indexes.column_name];
		if (columnValue != null) {
			table.columns.push({
				name: String(columnValue),
				type: toKustoType(String(row[indexes.data_type]))
			});
		}
	}

	if (!Object.keys(schema).length) throw new Error('DuckDB returned no databases.');
	return schema;
}

/** Starts one translated KQL query against an isolated in-browser DuckDB cluster. */
export function startEmulatedQuery(
	clusterId: string,
	database: string,
	kql: string
): QueryExecution {
	let cancelled = false;
	const promise = (async () => {
		const translation = await translateKqlToSql(kql);
		if (cancelled) throw new Error('Query cancelled.');
		if (!translation.success || !translation.sql) {
			throw new Error(translation.error || 'The KQL query could not be translated.');
		}

		const sql = `USE ${quoteDuckDbIdentifier(database)};\n${translation.sql}`;
		const result = await executeDuckDbQuery(sql, clusterId);
		if (cancelled) throw new Error('Query cancelled.');
		return result;
	})();

	return {
		promise,
		cancel() {
			// DuckDB-Wasm's materialized query API has no per-query cancellation handle.
			// Ignore a late result so it cannot update the active workspace.
			cancelled = true;
		}
	};
}
