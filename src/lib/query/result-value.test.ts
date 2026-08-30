import { describe, expect, it } from 'vitest';

import { normalizeResultValue } from './result-value';

describe('normalizeResultValue', () => {
	it('converts SDK-only values recursively without changing primitives', () => {
		const value = {
			at: new Date('2026-08-29T12:00:00.000Z'),
			id: 42n,
			nested: [true, { count: 3n }]
		};

		expect(normalizeResultValue(value)).toEqual({
			at: '2026-08-29T12:00:00.000Z',
			id: '42',
			nested: [true, { count: '3' }]
		});
	});
});
