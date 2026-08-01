import { describe, expect, it } from 'vitest';

import { compareCsvShape } from './ingestion-guardrails';

const target = [
	{ name: 'State', type: 'string' },
	{ name: 'Count', type: 'long' }
];

describe('ingestion CSV guardrails', () => {
	it('accepts matching positional rows and header names', () => {
		expect(
			compareCsvShape(
				{
					columnCount: 2,
					inconsistentRecordCount: 0,
					headerColumnCount: 2,
					headerColumns: ['State', 'Count']
				},
				target
			)
		).toEqual([]);
	});

	it('reports width, inconsistent rows, and positional header mismatches', () => {
		expect(
			compareCsvShape(
				{
					columnCount: 3,
					inconsistentRecordCount: 2,
					headerColumnCount: 2,
					headerColumns: ['Count', 'State']
				},
				target
			).map((warning) => warning.id)
		).toEqual(['column-count', 'inconsistent-row-width', 'header-order']);
	});
});
