import { describe, expect, it } from 'vitest';

import {
	buildEmulatedIngestionSql,
	describeEmulatedRemoteUrl,
	resolveEmulatedRemoteUrl
} from './data-ingestion';

describe('emulated DuckDB ingestion', () => {
	it('builds a positional CSV append with quoted identifiers', () => {
		expect(
			buildEmulatedIngestionSql('Analytics "lab"', 'Event rows', 'kite-ingest.csv', 'csv', true)
		).toBe(
			`INSERT INTO "Analytics ""lab""".main."Event rows" SELECT * FROM read_csv('kite-ingest.csv', header = true, auto_detect = true)`
		);
	});

	it('builds a Parquet append without CSV options', () => {
		expect(buildEmulatedIngestionSql('memory', 'Events', 'kite-ingest.parquet', 'parquet')).toBe(
			`INSERT INTO "memory".main."Events" SELECT * FROM read_parquet('kite-ingest.parquet')`
		);
	});

	it('preserves signed URLs for registration but masks their query in the UI', () => {
		const url = ' https://storage.example/events.csv?sig=a%2Fb%2Bc&sp=r ';
		expect(resolveEmulatedRemoteUrl(url)).toBe(
			'https://storage.example/events.csv?sig=a%2Fb%2Bc&sp=r'
		);
		expect(describeEmulatedRemoteUrl(url)).toBe('https://storage.example/events.csv?…');
	});

	it.each([
		'file:///tmp/data.csv',
		'ftp://storage.example/data.csv',
		'https://storage.example/data.csv#fragment',
		'https://user:secret@storage.example/data.csv',
		'https://storage.example/data.csv\nDROP TABLE Events'
	])('rejects unsupported remote URLs: %s', (url) => {
		expect(() => resolveEmulatedRemoteUrl(url)).toThrow();
	});
});
