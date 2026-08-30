import { describe, expect, it } from 'vitest';

import { qualifyDuckDbTable, quoteDuckDbIdentifier, quoteDuckDbString } from './sql-format';

describe('DuckDB SQL formatting', () => {
	it('quotes identifiers and attached main-schema tables', () => {
		expect(quoteDuckDbIdentifier(' Analytics "lab" ')).toBe('"Analytics ""lab"""');
		expect(qualifyDuckDbTable('Analytics "lab"', 'Event rows')).toBe(
			'"Analytics ""lab""".main."Event rows"'
		);
	});

	it('quotes string literals and rejects empty identifiers', () => {
		expect(quoteDuckDbString("O'Reilly")).toBe("'O''Reilly'");
		expect(() => quoteDuckDbIdentifier('  ')).toThrow('DuckDB identifiers cannot be empty.');
	});
});
