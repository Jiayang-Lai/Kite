import { describe, expect, it } from 'vitest';

import { getQueryDetails } from './query-details';

describe('getQueryDetails', () => {
	it('adds Azure Monitor diagnostics to the shared query details', () => {
		const details = getQueryDetails({
			columns: [],
			rows: [],
			totalRowCount: 16,
			renderedRowCount: 16,
			warnings: [],
			elapsedMs: 220,
			clientRequestId: 'request-id',
			statistics: {
				query: {
					queryHash: '108a976331a29466',
					resourceUsage: {
						cpu: { totalCpu: '00:00:00' },
						memory: { peakPerNode: 4195488 }
					},
					inputDatasetStatistics: {
						rows: { scanned: 12 },
						extents: { scanned: 3 }
					}
				},
				enhancedStats: {
					executionTimeBreakdown: { queue: 0, engine: 21, service: 199 },
					uncompressedResponseSize: 41729
				}
			}
		});
		const numberFormat = new Intl.NumberFormat();

		expect(details).toEqual(
			expect.arrayContaining([
				{ label: 'Execution time', value: '220 ms' },
				{ label: 'Engine execution time', value: '21 ms' },
				{
					label: 'Memory peak',
					value: `4.2 MB (${numberFormat.format(4195488)} bytes)`
				},
				{
					label: 'Response size (uncompressed)',
					value: `0.0 MB (${numberFormat.format(41729)} bytes)`
				},
				{ label: 'Request ID', value: 'request-id' }
			])
		);
	});

	it('keeps shared details available for non-Azure cluster types', () => {
		const details = getQueryDetails({
			columns: [],
			rows: [],
			totalRowCount: 1,
			renderedRowCount: 1,
			warnings: [],
			elapsedMs: 2.4,
			clientRequestId: 'kusto-request-id'
		});

		expect(details).toEqual([
			{ label: 'Execution time', value: '2 ms' },
			{ label: 'Rows returned', value: '1' },
			{ label: 'Rows rendered', value: '1' },
			{ label: 'Request ID', value: 'kusto-request-id' }
		]);
	});
});
