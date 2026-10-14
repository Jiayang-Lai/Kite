import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
	deletePersistentDuckDbStorage,
	disposeDuckDb,
	executeDuckDbSql
} from '$lib/duckdb/query-client';
import {
	createEmulatedStorage,
	registerEmulatedStorage,
	unregisterEmulatedStorage
} from '$lib/emulation/storage';
import { startEmulatedIngestion, type EmulatedIngestionSource } from './data-ingestion';
import { createEmulatedTable } from './schema-management';
import { qualifyDuckDbTable } from './sql-format';

// These tests ingest into real DuckDB-WASM, in both storage modes, and check the rows that land.
// Starting DuckDB is slow, so each storage mode shares one session and every test ingests into a
// table of its own.

let tableCount = 0;

// Quoted fields hold a comma, an escaped quote and a line break.
const CSV = [
	'State,Count,Note',
	'Texas,12,"Dallas, Houston"',
	'Ohio,8,"said ""hi"""',
	'Utah,3,"two',
	'lines"'
].join('\n');

const EXPECTED_ROWS = [
	['Ohio', 8, 'said "hi"'],
	['Texas', 12, 'Dallas, Houston'],
	['Utah', 3, 'two\nlines']
];

describe.each(['memory', 'opfs'] as const)('emulated CSV ingestion in %s storage', (mode) => {
	const cluster = `ingestion-test-${mode}-${crypto.randomUUID()}`;
	const storageId = `ingestion-storage-${crypto.randomUUID()}`;

	beforeAll(() => {
		registerEmulatedStorage(cluster, createEmulatedStorage(mode, storageId));
	});

	afterAll(async () => {
		await disposeDuckDb(cluster);
		if (mode === 'opfs') await deletePersistentDuckDbStorage(storageId);
		unregisterEmulatedStorage(cluster);
	});

	/** Creates an empty table no other test uses, with a name that needs quoting. */
	async function createTable() {
		tableCount += 1;
		const table = `Event ${tableCount}'s "Log"`;
		await createEmulatedTable(cluster, 'memory', {
			kind: 'create-table',
			command: '',
			risk: 'safe',
			summary: '',
			tableName: table,
			columns: [
				{ name: 'State', type: 'string' },
				{ name: 'Count', type: 'long' },
				{ name: 'Note', type: 'string' }
			],
			docstring: '',
			folder: ''
		});
		return table;
	}

	function ingest(table: string, source: EmulatedIngestionSource, hasHeader = true) {
		return startEmulatedIngestion({
			clusterId: cluster,
			database: 'memory',
			table,
			format: 'csv',
			hasHeader,
			source
		}).promise;
	}

	async function storedRows(table: string) {
		return (
			await executeDuckDbSql(
				`SELECT "State", "Count"::INTEGER, "Note" FROM ${qualifyDuckDbTable('memory', table)} ORDER BY "State"`,
				cluster
			)
		).rows;
	}

	it('appends inline CSV with quoted fields and reports the rows inserted', async () => {
		const table = await createTable();

		const result = await ingest(table, { kind: 'inline', data: CSV });

		expect(result.rows[0][0]).toBe('3');
		expect(await storedRows(table)).toEqual(EXPECTED_ROWS);
	});

	it('appends a local CSV file without a header row', async () => {
		const table = await createTable();
		const file = new File([CSV.split('\n').slice(1).join('\n')], 'events.csv', {
			type: 'text/csv'
		});

		await ingest(table, { kind: 'file', file }, false);

		expect(await storedRows(table)).toEqual(EXPECTED_ROWS);
	});

	it('inserts nothing when a row does not fit the table', async () => {
		const table = await createTable();

		await expect(
			ingest(table, { kind: 'inline', data: 'State,Count,Note\nTexas,12,ok\nOhio,many,bad' })
		).rejects.toThrow();

		expect(await storedRows(table)).toEqual([]);
	});
});
