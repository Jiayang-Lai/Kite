import { describe, expect, it, vi } from 'vitest';

const emulationMocks = vi.hoisted(() => ({
	createEmulatedDatabase: vi.fn(),
	createEmulatedTable: vi.fn(),
	dropEmulatedDatabase: vi.fn(),
	dropEmulatedTable: vi.fn(),
	mutateEmulatedTable: vi.fn()
}));

vi.mock('$lib/emulation/schema-management', () => emulationMocks);

import { createSchemaMutationAdapter } from './schema-mutation-adapter';
import type { KustoClusterConnection } from '$lib/kusto/query-client';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
import type { QueryResult } from '$lib/types/query-result';

const snapshot = {
	databaseName: 'Analytics',
	tableName: 'Events',
	columns: [{ name: 'Id', type: 'long' }],
	docstring: ''
} as const;

function result(columns: string[], rows: unknown[][]): QueryResult {
	return {
		columns: columns.map((name) => ({ name, type: 'string' })),
		rows,
		totalRowCount: rows.length,
		renderedRowCount: rows.length,
		warnings: [],
		elapsedMs: 0,
		clientRequestId: 'test'
	};
}

describe('schema mutation adapter', () => {
	it('provides the same mutation contract for every cluster kind', () => {
		const clusters: KustoClusterConnection[] = [
			{ id: 'mock', name: 'Mock', url: 'mock://kite', kind: 'mock' },
			{
				id: 'emulated',
				name: 'Emulated',
				url: 'emulated://kite',
				kind: 'emulated',
				emulatedStorage: { mode: 'memory' }
			},
			{ id: 'remote', name: 'Remote', url: 'https://example.test', kind: 'remote' },
			{
				id: 'logs',
				name: 'Logs',
				url: 'https://api.loganalytics.azure.com',
				kind: 'log-analytics',
				logAnalytics: {
					workspaceId: 'workspace-id',
					tenantId: 'tenant-id',
					clientId: 'client-id'
				}
			}
		];

		for (const cluster of clusters) {
			const adapter = createSchemaMutationAdapter({
				cluster,
				mockSchemaStore: { updateMockSchema: vi.fn() },
				mockSchemaRevision: 0
			});
			expect(adapter.prepareTable).toBeTypeOf('function');
			expect(adapter.dropTable).toBeTypeOf('function');
			expect(adapter.mutateTable).toBeTypeOf('function');
			expect(adapter.createTable).toBeTypeOf('function');
			expect(adapter.mutateDatabase).toBeTypeOf('function');
		}
	});

	it('makes unsupported Log Analytics mutations explicit', async () => {
		const adapter = createSchemaMutationAdapter({
			cluster: {
				id: 'logs',
				name: 'Logs',
				url: 'https://api.loganalytics.azure.com',
				kind: 'log-analytics',
				logAnalytics: {
					workspaceId: 'workspace-id',
					tenantId: 'tenant-id',
					clientId: 'client-id'
				}
			},
			mockSchemaStore: { updateMockSchema: vi.fn() },
			mockSchemaRevision: 0
		});

		const message = 'Schema mutations are unavailable for Log Analytics connections.';
		await expect(adapter.dropTable('Analytics', 'Events', snapshot)).rejects.toThrow(message);
		await expect(adapter.mutateTable('Analytics', 'Events', snapshot, {} as never)).rejects.toThrow(
			message
		);
		await expect(adapter.createTable('Analytics', {} as never)).rejects.toThrow(message);
		await expect(adapter.mutateDatabase('create', '', 'Archive')).rejects.toThrow(message);
	});

	it('applies mock mutations through the revision-aware connection store', async () => {
		const schema = { Analytics: { name: 'Analytics', tables: [], functions: [] } };
		const updateMockSchema = vi.fn((_id, _revision, mutation) => ({
			id: 'mock',
			name: 'Mock',
			url: 'mock://kite',
			kind: 'mock' as const,
			mockSchema: mutation(schema),
			mockSchemaRevision: 4
		}));
		const adapter = createSchemaMutationAdapter({
			cluster: { id: 'mock', name: 'Mock', url: 'mock://kite', kind: 'mock' },
			mockSchemaStore: { updateMockSchema },
			mockSchemaRevision: 3
		});

		const outcome = await adapter.mutateDatabase('create', '', 'Archive');
		expect(updateMockSchema).toHaveBeenCalledWith('mock', 3, expect.any(Function));
		expect(outcome).toEqual({ mockSchemaRevision: 4 });
		expect(updateMockSchema.mock.results[0].value.mockSchema.Archive).toMatchObject({
			name: 'Archive',
			tables: []
		});
	});

	it('applies every table and database mutation through the mock adapter', async () => {
		let schema: KustoDatabaseSchema = {
			Analytics: {
				name: 'Analytics',
				tables: [{ name: 'Events', columns: [{ name: 'Id', type: 'long' }], docstring: '' }],
				functions: []
			},
			Archive: { name: 'Archive', tables: [], functions: [] }
		};
		const updateMockSchema = vi.fn((_id, _revision, mutation) => {
			schema = mutation(schema);
			return {
				id: 'mock',
				name: 'Mock',
				url: 'mock://kite',
				kind: 'mock' as const,
				mockSchema: schema,
				mockSchemaRevision: 4
			};
		});
		const onstage = vi.fn();
		const adapter = createSchemaMutationAdapter({
			cluster: { id: 'mock', name: 'Mock', url: 'mock://kite', kind: 'mock' },
			mockSchemaStore: { updateMockSchema },
			mockSchemaRevision: 3,
			onstage
		});

		await expect(adapter.prepareTable('Analytics', snapshot)).resolves.toEqual({
			kind: 'verified',
			snapshot
		});
		await adapter.mutateTable('Analytics', 'Events', snapshot, {
			kind: 'update-table',
			command: '.alter table Events',
			risk: 'safe',
			summary: 'Add Message',
			addedColumns: [{ name: 'Message', type: 'string' }],
			updatesDocstring: true,
			nextDocstring: 'Event records'
		});
		await adapter.dropTable('Analytics', 'Events', {
			...snapshot,
			columns: [
				{ name: 'Id', type: 'long' },
				{ name: 'Message', type: 'string' }
			],
			docstring: 'Event records'
		});
		await adapter.createTable('Analytics', {
			kind: 'create-table',
			command: '.create table Logs',
			columnDocstringsCommand: '.alter column',
			tableName: 'Logs',
			columns: [{ name: 'Message', type: 'string' }],
			docstring: 'Log records',
			folder: '',
			risk: 'safe',
			summary: 'Create Logs'
		});
		await adapter.mutateDatabase('rename', 'Archive', 'Historical');
		await adapter.mutateDatabase('drop', 'Historical', '');

		expect(schema.Analytics.tables).toEqual([
			{ name: 'Logs', columns: [{ name: 'Message', type: 'string' }], docstring: 'Log records' }
		]);
		expect(schema.Historical).toBeUndefined();
		expect(onstage).toHaveBeenNthCalledWith(1, 'table-created');
		expect(onstage).toHaveBeenNthCalledWith(2, 'column-docstrings-applied');
		expect(updateMockSchema).toHaveBeenCalledTimes(5);
	});

	it('routes emulated mutations to the DuckDB schema service', async () => {
		const onstage = vi.fn();
		const adapter = createSchemaMutationAdapter({
			cluster: {
				id: 'emulated',
				name: 'Emulated',
				url: 'emulated://kite',
				kind: 'emulated',
				emulatedStorage: { mode: 'memory' }
			},
			mockSchemaStore: { updateMockSchema: vi.fn() },
			mockSchemaRevision: 0,
			onstage
		});
		const mutationPlan = {
			kind: 'update-table' as const,
			command: '.alter table Events',
			risk: 'safe' as const,
			summary: 'Add Message',
			addedColumns: [{ name: 'Message', type: 'string' as const }],
			updatesDocstring: false,
			nextDocstring: ''
		};
		const createPlan = {
			kind: 'create-table' as const,
			command: '.create table Logs',
			columnDocstringsCommand: '.alter column',
			tableName: 'Logs',
			columns: [{ name: 'Message', type: 'string' as const }],
			docstring: 'Log records',
			folder: '',
			risk: 'safe' as const,
			summary: 'Create Logs'
		};

		await expect(adapter.prepareTable('Analytics', snapshot)).resolves.toMatchObject({
			kind: 'verified'
		});
		await adapter.dropTable('Analytics', 'Events', snapshot);
		await adapter.mutateTable('Analytics', 'Events', snapshot, mutationPlan);
		await adapter.createTable('Analytics', createPlan);
		await adapter.mutateDatabase('create', '', 'Archive');
		await adapter.mutateDatabase('drop', 'Archive', '');
		await expect(adapter.mutateDatabase('rename', 'Analytics', 'Renamed')).rejects.toThrow(
			'DuckDB does not support renaming an attached database.'
		);

		expect(emulationMocks.dropEmulatedTable).toHaveBeenCalledWith(
			'emulated',
			'Analytics',
			'Events',
			snapshot
		);
		expect(emulationMocks.mutateEmulatedTable).toHaveBeenCalledWith(
			'emulated',
			'Analytics',
			'Events',
			snapshot,
			mutationPlan
		);
		expect(emulationMocks.createEmulatedTable).toHaveBeenCalledWith(
			'emulated',
			'Analytics',
			createPlan
		);
		expect(emulationMocks.createEmulatedDatabase).toHaveBeenCalledWith('emulated', 'Archive');
		expect(emulationMocks.dropEmulatedDatabase).toHaveBeenCalledWith('emulated', 'Archive');
		expect(onstage).toHaveBeenNthCalledWith(1, 'table-created');
		expect(onstage).toHaveBeenNthCalledWith(2, 'column-docstrings-applied');
	});

	it('verifies and mutates remote schemas through management commands', async () => {
		const startReadOnlyBatch = vi.fn(() => ({
			cancel: vi.fn(),
			promise: Promise.resolve([
				result(
					['TableName', 'DatabaseName', 'Schema', 'DocString'],
					[
						[
							'Events',
							'Analytics',
							JSON.stringify({
								Name: 'Events',
								OrderedColumns: [{ Name: 'Id', Type: 'long' }]
							}),
							''
						]
					]
				),
				result(['Schema'], [['Events(Id:long)']]),
				result(['TableId', 'TotalRowCount'], [['1', 0]])
			])
		}));
		const startManagementCommand = vi.fn(() => ({ cancel: vi.fn(), promise: Promise.resolve() }));
		const onstage = vi.fn();
		const adapter = createSchemaMutationAdapter({
			cluster: {
				id: 'remote',
				name: 'Remote',
				url: 'https://example.test',
				kind: 'remote'
			} satisfies KustoClusterConnection,
			mockSchemaStore: { updateMockSchema: vi.fn() },
			mockSchemaRevision: 0,
			onstage,
			executions: {
				startManagementCommand: startManagementCommand as never,
				startReadOnlyBatch: startReadOnlyBatch as never
			}
		});
		const mutationPlan = {
			kind: 'update-table' as const,
			command: '.alter table Events',
			risk: 'safe' as const,
			summary: 'Add Message',
			addedColumns: [{ name: 'Message', type: 'string' as const }],
			updatesDocstring: false,
			nextDocstring: ''
		};
		const createPlan = {
			kind: 'create-table' as const,
			command: '.create table Logs',
			columnDocstringsCommand: '.alter column',
			tableName: 'Logs',
			columns: [{ name: 'Message', type: 'string' as const }],
			docstring: 'Log records',
			folder: '',
			risk: 'safe' as const,
			summary: 'Create Logs'
		};

		await expect(adapter.prepareTable('Analytics', snapshot)).resolves.toMatchObject({
			kind: 'verified'
		});
		await adapter.dropTable('Analytics', 'Events', snapshot);
		await adapter.mutateTable('Analytics', 'Events', snapshot, mutationPlan);
		await adapter.createTable('Analytics', createPlan);
		await adapter.mutateDatabase('rename', 'Analytics', 'Archive');
		await expect(adapter.mutateDatabase('create', '', 'Archive')).rejects.toThrow(
			'The local backend does not support remote database creation or deletion.'
		);

		expect(startReadOnlyBatch).toHaveBeenCalledTimes(3);
		expect(startManagementCommand).toHaveBeenNthCalledWith(
			1,
			'Analytics',
			'.drop table Events',
			'https://example.test'
		);
		expect(startManagementCommand).toHaveBeenNthCalledWith(
			2,
			'Analytics',
			'.alter table Events',
			'https://example.test'
		);
		expect(startManagementCommand).toHaveBeenNthCalledWith(
			3,
			'Analytics',
			'.create table Logs',
			'https://example.test'
		);
		expect(startManagementCommand).toHaveBeenNthCalledWith(
			4,
			'Analytics',
			'.alter column',
			'https://example.test'
		);
		expect(startManagementCommand).toHaveBeenNthCalledWith(
			5,
			'Analytics',
			".alter database Analytics prettyname 'Archive'",
			'https://example.test'
		);
		expect(onstage).toHaveBeenNthCalledWith(1, 'table-created');
		expect(onstage).toHaveBeenNthCalledWith(2, 'column-docstrings-applied');
	});

	it('uses remote preflight results and exposes conflicts without issuing a mutation command', async () => {
		const cancel = vi.fn();
		const startManagementCommand = vi.fn();
		const startReadOnlyBatch = vi.fn(() => ({
			cancel,
			promise: Promise.resolve([
				result(
					['TableName', 'DatabaseName', 'Schema', 'DocString'],
					[
						[
							'Events',
							'Analytics',
							JSON.stringify({
								Name: 'Events',
								OrderedColumns: [{ Name: 'Changed', Type: 'long' }]
							}),
							''
						]
					]
				),
				result(['Schema'], [['Events(Id:long)']]),
				result(['TableId', 'TotalRowCount'], [['1', 0]])
			])
		}));
		const onexecution = vi.fn();
		const adapter = createSchemaMutationAdapter({
			cluster: {
				id: 'remote',
				name: 'Remote',
				url: 'https://example.test',
				kind: 'remote'
			} satisfies KustoClusterConnection,
			mockSchemaStore: { updateMockSchema: vi.fn() },
			mockSchemaRevision: 0,
			onexecution,
			executions: {
				startManagementCommand: startManagementCommand as never,
				startReadOnlyBatch: startReadOnlyBatch as never
			}
		});

		const outcome = await adapter.dropTable('Analytics', 'Events', snapshot);
		expect(outcome).toMatchObject({ kind: 'conflict' });
		expect(startManagementCommand).not.toHaveBeenCalled();
		expect(onexecution).toHaveBeenCalledOnce();
		expect(onexecution.mock.calls[0][0].cancel).toBe(cancel);
	});
});
