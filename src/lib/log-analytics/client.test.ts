import { describe, expect, it, vi } from 'vitest';

import type {
	LogAnalyticsQueryErrorResponse,
	LogAnalyticsQueryStatistics
} from '$lib/types/log-analytics';

vi.mock('./auth', () => ({ acquireLogAnalyticsToken: vi.fn(async () => 'access-token') }));

import { LOG_ANALYTICS_QUERY_PREFER, parseLogAnalyticsMetadata, startLogAnalyticsQuery } from './client';

describe('Log Analytics query options', () => {
	it('models nested Azure query diagnostics', () => {
		const response: LogAnalyticsQueryErrorResponse = {
			error: {
				message: 'The request had some invalid properties',
				code: 'BadArgumentError',
				correlationId: 'c2407cb9-b075-444f-91f5-17eb6b2f0564',
				innererror: {
					code: 'SyntaxError',
					message: 'A recognition error occurred in the query.',
					innererror: {
						code: 'SYN0002',
						message: "Query could not be parsed at '' on line [2,2]",
						line: 2,
						pos: 2,
						token: ''
					}
				}
			}
		};

		expect(response.error?.innererror?.innererror?.line).toBe(2);
	});

	it('matches the Azure portal options used for query diagnostics', () => {
		expect(LOG_ANALYTICS_QUERY_PREFER).toBe(
			'wait=600, ai.include-statistics=true, ai.include-render=true, include-datasources=true'
		);
	});

	it('uses Azure’s response request ID instead of the generated client ID', async () => {
		vi.stubGlobal('window', { setTimeout, clearTimeout });
		const statistics: LogAnalyticsQueryStatistics = {
			query: {
				queryHash: '108a976331a29466',
				executionTime: 0,
				resourceUsage: {
					memory: { peakPerNode: 1049344 },
					network: { interClusterTotalBytes: 1393, crossClusterTotalBytes: 0 }
				},
				inputDatasetStatistics: { rows: { total: 0, scanned: 0 } },
				datasetStatistics: [{ tableRowCount: 16, tableSize: 557 }],
				crossClusterResourceUsage: {}
			},
			enhancedStats: {
				executionTimeBreakdown: { queue: 0, engine: 134.558951, service: 142.058731 },
				uncompressedResponseSize: 4310
			}
		};
		const fetchMock = vi.fn(async () => ({
			ok: true,
			headers: new Headers({ 'x-ms-request-id': 'azure-request-id' }),
			json: async () => ({ tables: [{ columns: [], rows: [] }], statistics })
		}));
		vi.stubGlobal('fetch', fetchMock);

		try {
			const result = await startLogAnalyticsQuery(
				{
					workspaceId: 'workspace-id',
					tenantId: 'tenant-id',
					clientId: 'client-id'
				},
				'Take 1'
			).promise;

			expect(result.clientRequestId).toBe('azure-request-id');
			expect(result.statistics).toEqual(statistics);
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('/workspaces/workspace-id/query'),
				expect.objectContaining({
					headers: expect.objectContaining({
						Prefer: LOG_ANALYTICS_QUERY_PREFER
					})
				})
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('preserves Azure request IDs and raw errors for failed queries', async () => {
		vi.stubGlobal('window', { setTimeout, clearTimeout });
		const response = {
			error: {
				message: 'The request had some invalid properties',
				code: 'BadArgumentError',
				correlationId: 'correlation-id'
			}
		};
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: false,
				status: 400,
				headers: new Headers({ 'x-ms-request-id': 'azure-request-id' }),
				json: async () => response
			}))
		);

		try {
			await expect(
				startLogAnalyticsQuery(
					{ workspaceId: 'workspace-id', tenantId: 'tenant-id', clientId: 'client-id' },
					'Take 1'
				).promise
			).rejects.toMatchObject({
				name: 'LogAnalyticsQueryRequestError',
				requestId: 'azure-request-id',
				response
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('parseLogAnalyticsMetadata', () => {
	it('maps Logs metadata tables and columns into Kite schema metadata', () => {
		const schema = parseLogAnalyticsMetadata(
			{
				tables: [
					{
						name: 'AzureActivity',
						description: 'Azure control-plane activity.',
						columns: [{ name: 'TimeGenerated', type: 'datetime' }]
					}
				]
			},
			'Production logs',
			'workspace-id'
		);

		expect(schema['Production logs']).toMatchObject({
			name: 'Production logs',
			tables: [
				{
					name: 'AzureActivity',
					columns: [{ name: 'TimeGenerated', type: 'datetime' }]
				}
			]
		});
	});
});
