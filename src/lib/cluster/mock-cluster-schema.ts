import { MOCK_DATABASES } from '$lib/data/mock-databases';
import type { KustoClusterConnection } from '$lib/kusto/query-client';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, path: string) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`${path} must be a non-empty string.`);
	}
}

/** Copies JSON-compatible schema metadata without failing on Svelte reactive proxies. */
export function cloneMockSchema(schema: KustoDatabaseSchema): KustoDatabaseSchema {
	return JSON.parse(JSON.stringify(schema)) as KustoDatabaseSchema;
}

/** Returns the smallest useful schema for a newly created independent mock cluster. */
export function createStarterMockSchema(): KustoDatabaseSchema {
	return {
		Database: {
			name: 'Database',
			tables: [],
			functions: []
		}
	};
}

/**
 * Validates user-authored mock metadata before it crosses the Monaco worker boundary
 * or is persisted in browser storage.
 */
export function normalizeMockSchema(value: unknown): KustoDatabaseSchema {
	if (!isRecord(value)) {
		throw new Error('Mock schema must be a JSON object keyed by database name.');
	}

	const databases = Object.entries(value);
	if (!databases.length) {
		throw new Error('Mock schema must contain at least one database.');
	}

	for (const [databaseKey, databaseValue] of databases) {
		if (!isRecord(databaseValue)) {
			throw new Error(`Database "${databaseKey}" must be an object.`);
		}
		requireNonEmptyString(databaseValue.name, `Database "${databaseKey}".name`);
		if (databaseValue.name !== databaseKey) {
			throw new Error(`Database key "${databaseKey}" must match its name "${databaseValue.name}".`);
		}
		if (!Array.isArray(databaseValue.tables)) {
			throw new Error(`Database "${databaseKey}".tables must be an array.`);
		}
		if (databaseValue.functions !== undefined && !Array.isArray(databaseValue.functions)) {
			throw new Error(`Database "${databaseKey}".functions must be an array.`);
		}

		for (const [tableIndex, tableValue] of databaseValue.tables.entries()) {
			const tablePath = `Database "${databaseKey}".tables[${tableIndex}]`;
			if (!isRecord(tableValue)) throw new Error(`${tablePath} must be an object.`);
			requireNonEmptyString(tableValue.name, `${tablePath}.name`);
			if (!Array.isArray(tableValue.columns)) {
				throw new Error(`${tablePath}.columns must be an array.`);
			}

			for (const [columnIndex, columnValue] of tableValue.columns.entries()) {
				const columnPath = `${tablePath}.columns[${columnIndex}]`;
				if (!isRecord(columnValue)) throw new Error(`${columnPath} must be an object.`);
				requireNonEmptyString(columnValue.name, `${columnPath}.name`);
				requireNonEmptyString(columnValue.type, `${columnPath}.type`);
			}
		}

		for (const [functionIndex, functionValue] of (
			(databaseValue.functions as unknown[] | undefined) ?? []
		).entries()) {
			const functionPath = `Database "${databaseKey}".functions[${functionIndex}]`;
			if (!isRecord(functionValue)) throw new Error(`${functionPath} must be an object.`);
			requireNonEmptyString(functionValue.name, `${functionPath}.name`);
			if (
				functionValue.inputParameters !== undefined &&
				!Array.isArray(functionValue.inputParameters)
			) {
				throw new Error(`${functionPath}.inputParameters must be an array.`);
			}
		}
	}

	return cloneMockSchema(value as KustoDatabaseSchema);
}

/** Resolves a mock connection to its private schema or the built-in sample catalog. */
export function getMockClusterSchema(cluster: KustoClusterConnection): KustoDatabaseSchema {
	if (cluster.kind !== 'mock') {
		throw new Error('A remote cluster does not have a mock schema.');
	}
	// Connection records live in Svelte state. Return a plain snapshot so Monaco can
	// transfer the schema to its web worker using the structured-clone algorithm.
	return cloneMockSchema(cluster.mockSchema ?? MOCK_DATABASES);
}

/** Only Kite's built-in mock connection intentionally has no private schema payload. */
export function usesBuiltInMockCatalog(cluster: KustoClusterConnection | undefined) {
	return cluster?.kind === 'mock' && cluster.mockSchema === undefined;
}
