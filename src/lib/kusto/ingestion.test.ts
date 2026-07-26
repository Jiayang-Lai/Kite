import { describe, expect, it } from 'vitest';

import {
	buildInlineIngestionCommand,
	buildMountedFileIngestionCommand,
	getInlineFilePayloadBudget,
	quoteKustoEntity,
	resolveMountedFilePath
} from './ingestion';

describe('Kusto ingestion commands', () => {
	it('preserves inline CSV data exactly', () => {
		const data = 'Shoes,1000\n"Coats with ""quotes""",5\n//literal,7\n';
		expect(buildInlineIngestionCommand({ table: 'Purchases', data })).toBe(
			`.ingest inline into table Purchases <|\n${data}`
		);
	});

	it('adds stable ingest-by properties for retryable file chunks', () => {
		expect(
			buildInlineIngestionCommand({ table: 'Purchases', data: 'Shoes,1000\n', ingestBy: 'chunk-1' })
		).toBe(
			`.ingest inline into table Purchases with (format="csv", tags='["ingest-by:chunk-1"]', ingestIfNotExists='["chunk-1"]') <|\nShoes,1000\n`
		);
	});

	it('reserves command overhead from the inline-file payload budget', () => {
		const budget = getInlineFilePayloadBudget('Purchases', 1024);
		expect(budget).toBeGreaterThan(0);
		expect(budget).toBeLessThan(768);
	});

	it('quotes non-simple table names', () => {
		expect(quoteKustoEntity("Odd table's name")).toBe("['Odd table''s name']");
	});

	it('builds a mounted Parquet ingestion command', () => {
		expect(
			buildMountedFileIngestionCommand({
				table: 'metrics',
				containerRoot: '/kustodata/raw/',
				relativePath: 'telemetry/import.parquet',
				format: 'parquet'
			})
		).toBe(
			'.ingest into table metrics(@"/kustodata/raw/telemetry/import.parquet") with (format="parquet")'
		);
	});

	it('normalizes Windows separators in relative paths', () => {
		expect(resolveMountedFilePath('/kustodata/raw', 'folder\\data.csv')).toBe(
			'/kustodata/raw/folder/data.csv'
		);
	});

	it.each(['/absolute.csv', '../outside.csv', 'folder/../outside.csv', './data.csv', 'a//b.csv'])(
		'rejects unsafe mounted paths: %s',
		(relativePath) => {
			expect(() => resolveMountedFilePath('/kustodata/raw', relativePath)).toThrow();
		}
	);

	it('rejects empty inline data without changing valid whitespace', () => {
		expect(() => buildInlineIngestionCommand({ table: 'T', data: ' \n ' })).toThrow(
			'Enter at least one CSV row'
		);
	});
});
