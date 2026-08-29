import { beforeEach, describe, expect, it, vi } from 'vitest';

const schemaMocks = vi.hoisted(() => ({
	checkpointDuckDb: vi.fn<(clusterId: string) => Promise<void>>(),
	createDuckDbDatabase: vi.fn(),
	dropDuckDbDatabase: vi.fn(),
	executeDuckDbSql: vi.fn<(sql: string, clusterId: string) => Promise<unknown>>(),
	loadEmulatedSchema: vi.fn()
}));

vi.mock('$lib/duckdb/lazy-client', () => ({
	checkpointDuckDb: schemaMocks.checkpointDuckDb,
	createDuckDbDatabase: schemaMocks.createDuckDbDatabase,
	dropDuckDbDatabase: schemaMocks.dropDuckDbDatabase,
	executeDuckDbSql: schemaMocks.executeDuckDbSql
}));
vi.mock('$lib/emulation/cluster', () => ({
	loadEmulatedSchema: schemaMocks.loadEmulatedSchema
}));

import type { CreateTablePlan, TableSchemaSnapshot } from '$lib/kusto/table-management';
import { createEmulatedTable, dropEmulatedTable } from './schema-management';

const snapshot: TableSchemaSnapshot = {
	databaseName: 'Analytics',
	tableName: 'Events',
	columns: [{ name: 'State', type: 'string' }],
	docstring: 'Event rows'
};

beforeEach(() => {
	vi.clearAllMocks();
	schemaMocks.executeDuckDbSql.mockResolvedValue({});
	schemaMocks.checkpointDuckDb.mockResolvedValue();
	schemaMocks.loadEmulatedSchema.mockResolvedValue({
		Analytics: {
			name: 'Analytics',
			tables: [
				{
					name: 'Events',
					docstring: 'Event rows',
					columns: [{ name: 'State', type: 'string' }]
				}
			],
			functions: []
		}
	});
});

describe('emulated schema transactions', () => {
	it('creates tables and comments inside one checkpointed transaction', async () => {
		const plan: CreateTablePlan = {
			kind: 'create-table',
			command: '',
			tableName: 'Event Data',
			columns: [
				{ name: 'Recorded At', type: 'datetime', docstring: 'Capture time' },
				{ name: 'Payload', type: 'dynamic' }
			],
			docstring: "Today's events",
			folder: '',
			risk: 'safe',
			summary: ''
		};

		await createEmulatedTable('cluster', 'Analytics', plan);

		expect(schemaMocks.executeDuckDbSql.mock.calls.map(([sql]) => sql)).toEqual([
			'BEGIN TRANSACTION',
			'CREATE TABLE "Analytics".main."Event Data" ("Recorded At" TIMESTAMP, "Payload" JSON)',
			`COMMENT ON TABLE "Analytics".main."Event Data" IS 'Today''s events'`,
			`COMMENT ON COLUMN "Analytics".main."Event Data"."Recorded At" IS 'Capture time'`,
			'COMMIT'
		]);
		expect(schemaMocks.checkpointDuckDb).toHaveBeenCalledWith('cluster');
	});

	it('rolls back a failed mutation and preserves the original error', async () => {
		const mutationError = new Error('CREATE failed');
		schemaMocks.executeDuckDbSql.mockImplementation(async (sql: string) => {
			if (sql.startsWith('CREATE TABLE')) throw mutationError;
			if (sql === 'ROLLBACK') throw new Error('rollback also failed');
			return {};
		});

		await expect(
			createEmulatedTable('cluster', 'Analytics', {
				kind: 'create-table',
				command: '',
				tableName: 'Events',
				columns: [{ name: 'State', type: 'string' }],
				docstring: '',
				folder: '',
				risk: 'safe',
				summary: ''
			})
		).rejects.toBe(mutationError);
		expect(schemaMocks.executeDuckDbSql).toHaveBeenLastCalledWith('ROLLBACK', 'cluster');
		expect(schemaMocks.checkpointDuckDb).not.toHaveBeenCalled();
	});

	it('blocks a stale destructive plan before issuing DuckDB SQL', async () => {
		schemaMocks.loadEmulatedSchema.mockResolvedValue({
			Analytics: {
				name: 'Analytics',
				tables: [{ name: 'Events', docstring: 'Changed', columns: [...snapshot.columns] }],
				functions: []
			}
		});

		await expect(dropEmulatedTable('cluster', 'Analytics', 'Events', snapshot)).rejects.toThrow(
			'DuckDB table changed while this editor was open'
		);
		expect(schemaMocks.executeDuckDbSql).not.toHaveBeenCalled();
		expect(schemaMocks.checkpointDuckDb).not.toHaveBeenCalled();
	});
});
