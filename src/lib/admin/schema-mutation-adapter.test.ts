import { describe, expect, it, vi } from 'vitest';

import { createSchemaMutationAdapter } from './schema-mutation-adapter';
import type { KustoClusterConnection } from '$lib/kusto/query-client';
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

		await expect(adapter.mutateDatabase('create', '', 'Archive')).rejects.toThrow(
			'Schema mutations are unavailable for Log Analytics connections.'
		);
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
