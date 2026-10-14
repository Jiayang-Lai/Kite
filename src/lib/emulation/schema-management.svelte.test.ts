import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import DUCKDB_BUNDLES from '#kite-duckdb-bundles';
import {
	deletePersistentDuckDbStorage,
	disposeDuckDb,
	executeDuckDbSql
} from '$lib/duckdb/query-client';
import { loadEmulatedSchema } from '$lib/emulation/cluster';
import {
	createEmulatedStorage,
	registerEmulatedStorage,
	unregisterEmulatedStorage
} from '$lib/emulation/storage';
import {
	buildEditColumnPlan,
	snapshotLoadedTable,
	type CreateTablePlan,
	type NewTableColumn,
	type TableMutationPlan
} from '$lib/kusto/table-management';
import {
	createEmulatedDatabase,
	createEmulatedTable,
	dropEmulatedDatabase,
	dropEmulatedTable,
	mutateEmulatedTable
} from './schema-management';
import { qualifyDuckDbTable } from './sql-format';

// These tests run the generated DDL against real DuckDB-WASM, in both storage modes, and check
// the schema and rows DuckDB reports afterwards rather than the SQL text. Starting DuckDB is
// slow, so each storage mode shares one session and every test works on tables of its own.

const base = { command: '', risk: 'safe', summary: '' } as const;
let tableCount = 0;

/** A table name no other test in the session uses, holding characters that need quoting. */
function uniqueTableName(label: string) {
	tableCount += 1;
	return `${label} ${tableCount}'s "t" \\`;
}

function createPlan(tableName: string, columns: NewTableColumn[], docstring = ''): CreateTablePlan {
	return { ...base, kind: 'create-table', tableName, columns, docstring, folder: '' };
}

it('loads DuckDB from Kite rather than a CDN', () => {
	for (const bundle of Object.values(DUCKDB_BUNDLES)) {
		expect(new URL(bundle.mainModule, location.href).origin).toBe(location.origin);
	}
});

describe.each(['memory', 'opfs'] as const)('emulated schema changes in %s storage', (mode) => {
	const cluster = `schema-test-${mode}-${crypto.randomUUID()}`;
	const storageId = `schema-storage-${crypto.randomUUID()}`;

	beforeAll(() => {
		registerEmulatedStorage(cluster, createEmulatedStorage(mode, storageId));
	});

	afterAll(async () => {
		await disposeDuckDb(cluster);
		if (mode === 'opfs') await deletePersistentDuckDbStorage(storageId);
		unregisterEmulatedStorage(cluster);
	});

	async function tableNames(database = 'memory') {
		return ((await loadEmulatedSchema(cluster))[database]?.tables ?? []).map((table) => table.name);
	}

	async function loadTable(table: string, database = 'memory') {
		const schema = await loadEmulatedSchema(cluster);
		const found = schema[database]?.tables.find((candidate) => candidate.name === table);
		if (!found) throw new Error(`${database}.${table} is not in the schema.`);
		return found;
	}

	async function rows(sql: string) {
		return (await executeDuckDbSql(sql, cluster)).rows;
	}

	it('creates a table whose names and comments hold quotes and backslashes', async () => {
		const table = uniqueTableName('Events');

		await createEmulatedTable(
			cluster,
			'memory',
			createPlan(
				table,
				[
					{ name: 'Recorded At', type: 'datetime', docstring: `When it's "recorded" \\` },
					{ name: 'Count', type: 'long' },
					{ name: 'Payload', type: 'dynamic' }
				],
				`Today's "events" \\`
			)
		);

		expect(await loadTable(table)).toEqual({
			name: table,
			docstring: `Today's "events" \\`,
			columns: [
				{ name: 'Recorded At', type: 'datetime', docstring: `When it's "recorded" \\` },
				{ name: 'Count', type: 'long', docstring: undefined },
				{ name: 'Payload', type: 'dynamic', docstring: undefined }
			]
		});
	});

	it('maps every Kusto column type to a DuckDB type that reads back as the same Kusto type', async () => {
		const table = uniqueTableName('Types');
		const types = [
			'bool',
			'datetime',
			'decimal',
			'dynamic',
			'guid',
			'int',
			'long',
			'real',
			'string',
			'timespan'
		] as const;

		await createEmulatedTable(
			cluster,
			'memory',
			createPlan(
				table,
				types.map((type) => ({ name: `c_${type}`, type }))
			)
		);

		expect((await loadTable(table)).columns.map((column) => column.type)).toEqual([...types]);
	});

	it('leaves no table behind when creation fails part way', async () => {
		const table = uniqueTableName('Broken');

		await expect(
			createEmulatedTable(
				cluster,
				'memory',
				createPlan(table, [
					{ name: 'Id', type: 'long' },
					{ name: 'Id', type: 'string' }
				])
			)
		).rejects.toThrow();

		expect(await tableNames()).not.toContain(table);
	});

	describe('on an existing table', () => {
		async function seededTable() {
			const table = uniqueTableName('Events');
			await createEmulatedTable(
				cluster,
				'memory',
				createPlan(
					table,
					[
						{ name: 'State', type: 'string', docstring: 'US state' },
						{ name: 'Count', type: 'string', docstring: 'Event count' }
					],
					'Event rows'
				)
			);
			const qualified = qualifyDuckDbTable('memory', table);
			await executeDuckDbSql(
				`INSERT INTO ${qualified} VALUES ('Texas', '12'), ('Ohio', '8')`,
				cluster
			);
			return { table, qualified };
		}

		async function mutate(table: string, plan: TableMutationPlan) {
			const current = await loadTable(table);
			await mutateEmulatedTable(
				cluster,
				'memory',
				table,
				snapshotLoadedTable('memory', current),
				plan
			);
			return loadTable(table);
		}

		it('adds columns with descriptions and replaces the table comment', async () => {
			const { table, qualified } = await seededTable();

			const updated = await mutate(table, {
				...base,
				kind: 'update-table',
				addedColumns: [
					{ name: `Owner's "Team"`, type: 'string', docstring: `Team's "owner" \\` },
					{ name: 'Notes', type: 'string' }
				],
				updatesDocstring: true,
				nextDocstring: 'Renamed rows'
			});

			expect(updated.docstring).toBe('Renamed rows');
			expect(updated.columns).toEqual([
				{ name: 'State', type: 'string', docstring: 'US state' },
				{ name: 'Count', type: 'string', docstring: 'Event count' },
				{ name: `Owner's "Team"`, type: 'string', docstring: `Team's "owner" \\` },
				{ name: 'Notes', type: 'string', docstring: undefined }
			]);
			expect(await rows(`SELECT count(*)::INTEGER FROM ${qualified}`)).toEqual([[2]]);
		});

		it('clears the table comment', async () => {
			const { table } = await seededTable();

			const updated = await mutate(table, {
				...base,
				kind: 'update-table',
				addedColumns: [],
				updatesDocstring: true,
				nextDocstring: ''
			});

			expect(updated.docstring).toBeUndefined();
		});

		function editPlan(newColumnName: string, nextDocstring: string, currentDocstring = 'US state') {
			return buildEditColumnPlan({
				tableName: 'unused',
				columnName: 'State',
				currentDocstring,
				newColumnName,
				nextDocstring,
				existingColumnNames: ['State', 'Count']
			});
		}

		it('renames a column and keeps its rows and description', async () => {
			const { table, qualified } = await seededTable();

			const updated = await mutate(table, editPlan(`Region "EU"`, 'US state'));

			expect(updated.columns[0]).toEqual({
				name: `Region "EU"`,
				type: 'string',
				docstring: 'US state'
			});
			expect(await rows(`SELECT "Region ""EU""" FROM ${qualified} ORDER BY 1`)).toEqual([
				['Ohio'],
				['Texas']
			]);
		});

		it('renames a column and changes its description together', async () => {
			const { table } = await seededTable();

			const updated = await mutate(table, editPlan('Region', `Region's "name" \\`));

			expect(updated.columns[0]).toEqual({
				name: 'Region',
				type: 'string',
				docstring: `Region's "name" \\`
			});
		});

		it('changes or clears only a column description', async () => {
			const { table } = await seededTable();

			expect((await mutate(table, editPlan('State', 'Two-letter code'))).columns[0]).toEqual({
				name: 'State',
				type: 'string',
				docstring: 'Two-letter code'
			});

			const cleared = await mutate(table, editPlan('State', '', 'Two-letter code'));
			expect(cleared.columns[0].docstring).toBeUndefined();
			expect(cleared.columns[1].docstring).toBe('Event count');
		});

		it('refuses to overwrite a description another client changed after the editor opened', async () => {
			const { table, qualified } = await seededTable();
			const opened = snapshotLoadedTable('memory', await loadTable(table));
			await executeDuckDbSql(`COMMENT ON COLUMN ${qualified}."State" IS 'Set elsewhere'`, cluster);

			await expect(
				mutateEmulatedTable(cluster, 'memory', table, opened, editPlan('State', 'Mine'))
			).rejects.toThrow('The description of column State changed.');
			expect((await loadTable(table)).columns[0].docstring).toBe('Set elsewhere');
		});

		it('changes a column type and converts its values', async () => {
			const { table, qualified } = await seededTable();

			const updated = await mutate(table, {
				...base,
				kind: 'change-column-type',
				columnName: 'Count',
				currentColumnType: 'string',
				newColumnType: 'long'
			});

			expect(updated.columns.find((column) => column.name === 'Count')?.type).toBe('long');
			expect(await rows(`SELECT sum("Count")::INTEGER FROM ${qualified}`)).toEqual([[20]]);
		});

		it('drops a column', async () => {
			const { table } = await seededTable();

			const updated = await mutate(table, { ...base, kind: 'drop-column', columnName: 'Count' });

			expect(updated.columns.map((column) => column.name)).toEqual(['State']);
		});

		it('drops the table', async () => {
			const { table } = await seededTable();
			const current = await loadTable(table);

			await dropEmulatedTable(cluster, 'memory', table, snapshotLoadedTable('memory', current));

			expect(await tableNames()).not.toContain(table);
		});
	});

	it('creates and drops a database whose name holds a quote', async () => {
		const name = `Sales "EU" '26`;

		await createEmulatedDatabase(cluster, name);
		await createEmulatedTable(cluster, name, createPlan('Orders', [{ name: 'Id', type: 'long' }]));
		expect((await loadTable('Orders', name)).columns).toHaveLength(1);

		await dropEmulatedDatabase(cluster, name);
		expect(Object.keys(await loadEmulatedSchema(cluster))).not.toContain(name);
	});
});
