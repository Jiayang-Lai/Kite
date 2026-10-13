import { describe, expect, it } from 'vitest';

import { quoteKustoEntity, quoteKustoString } from './command-format';

describe('Kusto command formatting', () => {
	it('escapes quotes and backslashes with Kusto backslash escapes', () => {
		expect(quoteKustoString("It's")).toBe("'It\\'s'");
		expect(quoteKustoString('C:\\data\\')).toBe("'C:\\\\data\\\\'");
	});

	it('keeps trailing backslashes from escaping the closing quote', () => {
		expect(quoteKustoString("a\\', y = 1 //")).toBe("'a\\\\\\', y = 1 //'");
	});

	it('uses the same escaping for bracketed entity names', () => {
		expect(quoteKustoEntity("a'b\\")).toBe("['a\\'b\\\\']");
		expect(quoteKustoEntity('Simple_name1')).toBe('Simple_name1');
	});
});
