import { describe, expect, it } from 'vitest';

import {
	applyMockCreateDatabase,
	applyMockCreateTable,
	applyMockDropDatabase,
	applyMockRenameDatabase,
	applyMockTableMutation
} from './mock-schema-management';
import {
	buildChangeColumnTypePlan,
	buildCreateTablePlan,
	buildDropColumnPlan,
	buildRenameColumnPlan,
	buildReorderTableColumnsPlan,
	buildTableMutationPlan,
	snapshotLoadedTable
} from '$lib/kusto/table-management';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

function createSchema(): KustoDatabaseSchema {
	return {
		Analytics: {
			name: 'Analytics',
			tables: [
				{
					name: 'Events',
					docstring: 'Original',
					columns: [
						{ name: 'Timestamp', type: 'datetime', docstring: 'Event time' },
						{ name: 'Value', type: 'long' }
					]
				}
			],
			functions: []
		}
	};
}

describe('mock schema management', () => {
	it('creates, renames, and drops databases immutably', () => {
		const original = createSchema();
		const created = applyMockCreateDatabase(original, 'Telemetry');
		const renamed = applyMockRenameDatabase(created, 'Telemetry', 'Operations');
		const dropped = applyMockDropDatabase(renamed, 'Analytics');

		expect(original).toHaveProperty('Analytics');
		expect(original).not.toHaveProperty('Telemetry');
		expect(created.Telemetry).toEqual({ name: 'Telemetry', tables: [], functions: [] });
		expect(renamed).not.toHaveProperty('Telemetry');
		expect(renamed.Operations.name).toBe('Operations');
		expect(dropped).not.toHaveProperty('Analytics');
		expect(dropped).toHaveProperty('Operations');
	});

	it('accepts reactive proxy schemas from the Svelte connection store', () => {
		const proxiedSchema = new Proxy(createSchema(), {});

		const updated = applyMockCreateDatabase(proxiedSchema, 'Telemetry');

		expect(updated.Telemetry).toEqual({ name: 'Telemetry', tables: [], functions: [] });
		expect(proxiedSchema).not.toHaveProperty('Telemetry');
	});

	it('does not remove the final database', () => {
		expect(() => applyMockDropDatabase(createSchema(), 'Analytics')).toThrow(
			'must contain at least one database'
		);
	});

	it('creates a table from the same plan used by remote clusters', () => {
		const schema = createSchema();
		const plan = buildCreateTablePlan({
			tableName: 'Metrics',
			existingTableNames: ['Events'],
			columns: [{ name: 'Count', type: 'long' }],
			docstring: 'Mock metrics'
		});

		const updated = applyMockCreateTable(schema, 'Analytics', plan);

		expect(updated.Analytics.tables.at(-1)).toEqual({
			name: 'Metrics',
			columns: [{ name: 'Count', type: 'long' }],
			docstring: 'Mock metrics'
		});
		expect(schema.Analytics.tables).toHaveLength(1);
	});

	it('applies all table mutation plan variants while preserving column metadata', () => {
		let schema = createSchema();
		let table = schema.Analytics.tables[0];
		let snapshot = snapshotLoadedTable('Analytics', table);

		schema = applyMockTableMutation(
			schema,
			'Analytics',
			'Events',
			snapshot,
			buildTableMutationPlan({
				tableName: 'Events',
				currentDocstring: 'Original',
				nextDocstring: 'Updated',
				existingColumnNames: ['Timestamp', 'Value'],
				newColumns: [{ name: 'Source', type: 'string' }]
			})
		);
		table = schema.Analytics.tables[0];
		snapshot = snapshotLoadedTable('Analytics', table);
		schema = applyMockTableMutation(
			schema,
			'Analytics',
			'Events',
			snapshot,
			buildRenameColumnPlan({
				tableName: 'Events',
				columnName: 'Source',
				newColumnName: 'Origin',
				existingColumnNames: table.columns.map((column) => column.name)
			})
		);
		table = schema.Analytics.tables[0];
		snapshot = snapshotLoadedTable('Analytics', table);
		schema = applyMockTableMutation(
			schema,
			'Analytics',
			'Events',
			snapshot,
			buildChangeColumnTypePlan({
				tableName: 'Events',
				columnName: 'Value',
				currentColumnType: 'long',
				newColumnType: 'real',
				existingColumnNames: table.columns.map((column) => column.name)
			})
		);
		table = schema.Analytics.tables[0];
		snapshot = snapshotLoadedTable('Analytics', table);
		schema = applyMockTableMutation(
			schema,
			'Analytics',
			'Events',
			snapshot,
			buildReorderTableColumnsPlan({
				snapshot,
				orderedSourceIndexes: [2, 0, 1]
			})
		);
		table = schema.Analytics.tables[0];
		snapshot = snapshotLoadedTable('Analytics', table);
		schema = applyMockTableMutation(
			schema,
			'Analytics',
			'Events',
			snapshot,
			buildDropColumnPlan({
				tableName: 'Events',
				columnName: 'Origin',
				existingColumnNames: table.columns.map((column) => column.name)
			})
		);

		expect(schema.Analytics.tables[0]).toMatchObject({
			docstring: 'Updated',
			columns: [
				{ name: 'Timestamp', type: 'datetime', docstring: 'Event time' },
				{ name: 'Value', type: 'real' }
			]
		});
	});

	it('rejects a stale table snapshot before applying a mutation', () => {
		const schema = createSchema();
		const staleSnapshot = snapshotLoadedTable('Analytics', schema.Analytics.tables[0]);
		const changedSchema: KustoDatabaseSchema = {
			...schema,
			Analytics: {
				...schema.Analytics,
				tables: [
					{
						...schema.Analytics.tables[0],
						columns: [...schema.Analytics.tables[0].columns, { name: 'New', type: 'string' }]
					}
				]
			}
		};
		const plan = buildRenameColumnPlan({
			tableName: 'Events',
			columnName: 'Value',
			newColumnName: 'Reading',
			existingColumnNames: ['Timestamp', 'Value']
		});

		expect(() =>
			applyMockTableMutation(changedSchema, 'Analytics', 'Events', staleSnapshot, plan)
		).toThrow('changed while this editor was open');
	});
});
