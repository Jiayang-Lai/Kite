import { describe, expect, it } from 'vitest';

import { materializeDuckDbResult, normalizeDuckDbValue } from './result';

describe('DuckDB result materialization', () => {
	it('normalizes values that cannot cross the renderer boundary directly', () => {
		expect(
			normalizeDuckDbValue({
				createdAt: new Date('2026-01-02T03:04:05.000Z'),
				count: 42n,
				bytes: new Uint8Array([1, 2]),
				nested: [3n]
			})
		).toEqual({
			createdAt: '2026-01-02T03:04:05.000Z',
			count: '42',
			bytes: [1, 2],
			nested: ['3']
		});
	});

	it('materializes rows in schema order with type names and timing', () => {
		const result = materializeDuckDbResult(
			{
				schema: {
					fields: [
						{ name: 'Name', type: { toString: () => 'VARCHAR' } },
						{ name: 'Count', type: { toString: () => 'BIGINT' } }
					]
				},
				toArray: () => [{ Count: 7n, Name: 'Events' }]
			},
			12
		);

		expect(result).toEqual({
			columns: [
				{ name: 'Name', type: 'VARCHAR' },
				{ name: 'Count', type: 'BIGINT' }
			],
			rows: [['Events', '7']],
			elapsedMs: 12
		});
	});
});
