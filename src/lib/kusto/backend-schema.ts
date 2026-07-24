import { getKustoClusterUrl } from '$lib/kusto/query-client';
import type { KustoDatabase, KustoDatabaseSchema } from '$lib/types/kusto-schema';
import { Client as KustoClient, type KustoResultRow } from 'azure-kusto-data';

type ShowColumn = {
	Name: string;
	Type?: string;
	CslType?: string;
	DocString?: string;
};

type ShowFunction = {
	Name: string;
	Body: string;
	DocString?: string;
	InputParameters?: ShowColumn[];
};

type ShowTable = {
	Name: string;
	DocString?: string;
	OrderedColumns?: ShowColumn[];
};

type ShowDatabase = {
	Name: string;
	MajorVersion?: number;
	MinorVersion?: number;
	Tables?: Record<string, ShowTable>;
	Functions?: Record<string, ShowFunction>;
};

type ShowSchema = { Databases?: Record<string, ShowDatabase> };

function firstRow(rows: Iterable<KustoResultRow>) {
	for (const row of rows) return row;
	return undefined;
}

function toDatabase(database: ShowDatabase): KustoDatabase {
	return {
		name: database.Name,
		majorVersion: database.MajorVersion ?? 1,
		minorVersion: database.MinorVersion ?? 0,
		tables: Object.values(database.Tables ?? {}).map((table) => ({
			name: table.Name,
			docstring: table.DocString,
			columns: (table.OrderedColumns ?? []).map((column) => ({
				name: column.Name,
				type: column.CslType ?? column.Type ?? 'dynamic',
				docstring: column.DocString
			}))
		})),
		functions: Object.values(database.Functions ?? {}).map((fn) => ({
			name: fn.Name,
			body: fn.Body,
			docstring: fn.DocString,
			inputParameters: (fn.InputParameters ?? []).map((parameter) => ({
				name: parameter.Name,
				type: parameter.CslType ?? parameter.Type ?? 'dynamic',
				cslType: parameter.CslType,
				docstring: parameter.DocString
			}))
		}))
	};
}

/** Parses a `.show database schema as json` value into Kite's compact schema. */
export function parseBackendSchema(serializedSchema: string): KustoDatabaseSchema {
	const parsed = JSON.parse(serializedSchema) as ShowSchema;
	return Object.fromEntries(
		Object.values(parsed.Databases ?? {}).map((database) => [database.Name, toDatabase(database)])
	);
}

/**
 * Discovers every database from the local cluster and converts its show-schema
 * payload into the same compact metadata consumed by Monaco-Kusto and the UI.
 */
export async function loadBackendSchema(
	clusterUrl = getKustoClusterUrl()
): Promise<KustoDatabaseSchema> {
	const client = new KustoClient(clusterUrl);
	try {
		const databaseResponse = await client.executeMgmt('NetDefaultDB', '.show databases details');
		const databaseTable = databaseResponse.primaryResults[0];
		const databaseDetails = databaseTable
			? Array.from(databaseTable.rows(), (row) => ({
					name: String(row.DatabaseName),
					prettyName:
						typeof row.PrettyName === 'string' && row.PrettyName.trim()
							? row.PrettyName.trim()
							: undefined
				}))
			: [];

		if (!databaseDetails.length) throw new Error('The Kusto backend returned no databases.');

		const schema: KustoDatabaseSchema = {};
		for (const { name: databaseName, prettyName } of databaseDetails) {
			const response = await client.executeMgmt(databaseName, '.show database schema as json');
			const row = response.primaryResults[0]
				? firstRow(response.primaryResults[0].rows())
				: undefined;
			const serializedSchema = row?.DatabaseSchema;
			if (typeof serializedSchema !== 'string') {
				throw new Error(`The backend returned no schema for ${databaseName}.`);
			}

			Object.assign(schema, parseBackendSchema(serializedSchema));
			if (schema[databaseName] && prettyName) schema[databaseName].prettyName = prettyName;
		}

		if (!Object.keys(schema).length) throw new Error('The backend schema was empty.');
		return schema;
	} finally {
		client.close();
	}
}
