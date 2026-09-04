import { describe, expect, it } from 'vitest';

import {
	quoteDuckDbIdentifier,
	quoteDuckDbString,
	rewritePersistentDuckDbSql
} from './persistent-sql';

describe('persistent DuckDB SQL', () => {
	it('quotes identifiers and strings', () => {
		expect(quoteDuckDbIdentifier('database "one"')).toBe('"database ""one"""');
		expect(quoteDuckDbString("database 'one'")).toBe("'database ''one'''");
	});

	it('leaves memory and uninitialized persistent sessions unchanged', () => {
		const sql = 'USE "Analytics"; SELECT * FROM "Analytics".main."Events"';
		expect(rewritePersistentDuckDbSql(sql, 'memory')).toBe(sql);
		expect(rewritePersistentDuckDbSql(sql, 'opfs')).toBe(sql);
	});

	it('rewrites logical schema selection and qualified table references', () => {
		expect(
			rewritePersistentDuckDbSql(
				'USE "Analytics"; SELECT * FROM "Analytics".main."Events"',
				'opfs',
				'kite catalog'
			)
		).toBe('\nSET schema = \'Analytics\'; SELECT * FROM "kite catalog"."Analytics"."Events"');
	});

	it('preserves escaped logical database names', () => {
		expect(rewritePersistentDuckDbSql('USE "Lab ""A"""', 'opfs', 'catalog')).toBe(
			'\nSET schema = \'Lab "A"\';'
		);
	});
});
