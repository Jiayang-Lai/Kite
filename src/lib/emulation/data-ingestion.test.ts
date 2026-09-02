import { beforeEach, describe, expect, it, vi } from 'vitest';

const ingestionMocks = vi.hoisted(() => ({
	loadSchema: vi.fn(),
	startFileQuery: vi.fn()
}));

vi.mock('$lib/emulation/cluster', () => ({ loadEmulatedSchema: ingestionMocks.loadSchema }));
vi.mock('$lib/duckdb/lazy-client', () => ({ startDuckDbFileQuery: ingestionMocks.startFileQuery }));

import {
	buildEmulatedIngestionSql,
	describeEmulatedRemoteUrl,
	resolveEmulatedRemoteUrl,
	startEmulatedIngestion
} from './data-ingestion';

const baseResult = {
	columns: [{ name: 'Count', type: 'BIGINT' }],
	rows: [[3]],
	totalRowCount: 1,
	renderedRowCount: 1,
	warnings: [],
	elapsedMs: 12,
	clientRequestId: 'ingestion-test'
};

beforeEach(() => {
	vi.clearAllMocks();
	ingestionMocks.loadSchema.mockResolvedValue({
		Analytics: { name: 'Analytics', tables: [{ name: 'Events', columns: [] }], functions: [] }
	});
	ingestionMocks.startFileQuery.mockReturnValue({
		promise: Promise.resolve(baseResult),
		cancel: vi.fn()
	});
});

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

	it.each(['', 'not a url'])('rejects missing or malformed remote URLs: %s', (url) => {
		expect(() => resolveEmulatedRemoteUrl(url)).toThrow('valid remote file URL');
	});

	it('ingests inline CSV and summarizes the inserted rows', async () => {
		const execution = startEmulatedIngestion({
			clusterId: 'cluster',
			database: 'Analytics',
			table: 'Events',
			format: 'csv',
			hasHeader: true,
			source: { kind: 'inline', data: 'Id\n1\n2\n3' }
		});

		await expect(execution.promise).resolves.toMatchObject({
			rows: [[3, 'Analytics', 'Events', 'Inline CSV']],
			totalRowCount: 1,
			warnings: []
		});
		expect(ingestionMocks.startFileQuery).toHaveBeenCalledWith({
			sessionId: 'cluster',
			source: { kind: 'text', text: 'Id\n1\n2\n3' },
			fileExtension: 'csv',
			buildSql: expect.any(Function)
		});
		const buildSql = ingestionMocks.startFileQuery.mock.calls[0][0].buildSql;
		expect(buildSql('registered.csv')).toContain("read_csv('registered.csv', header = true");
	});

	it('registers local files and remote URLs with useful source labels', async () => {
		const file = new File(['row'], 'events.parquet');
		const local = startEmulatedIngestion({
			clusterId: 'cluster',
			database: 'Analytics',
			table: 'Events',
			format: 'parquet',
			source: { kind: 'file', file }
		});
		await expect(local.promise).resolves.toMatchObject({
			rows: [[3, 'Analytics', 'Events', 'events.parquet']]
		});

		const remote = startEmulatedIngestion({
			clusterId: 'cluster',
			database: 'Analytics',
			table: 'Events',
			format: 'csv',
			source: { kind: 'remote', url: 'https://storage.example/events.csv?token=secret' }
		});
		await expect(remote.promise).resolves.toMatchObject({
			rows: [[3, 'Analytics', 'Events', 'https://storage.example/events.csv?…']]
		});
	});

	it('validates sources before loading schema', async () => {
		const emptyInline = startEmulatedIngestion({
			clusterId: 'cluster',
			database: 'Analytics',
			table: 'Events',
			format: 'csv',
			source: { kind: 'inline', data: '  ' }
		});
		await expect(emptyInline.promise).rejects.toThrow('at least one CSV row');

		const inlineParquet = startEmulatedIngestion({
			clusterId: 'cluster',
			database: 'Analytics',
			table: 'Events',
			format: 'parquet',
			source: { kind: 'inline', data: 'row' }
		});
		await expect(inlineParquet.promise).rejects.toThrow('CSV data only');

		const emptyFile = startEmulatedIngestion({
			clusterId: 'cluster',
			database: 'Analytics',
			table: 'Events',
			format: 'csv',
			source: { kind: 'file', file: new File([], 'empty.csv') }
		});
		await expect(emptyFile.promise).rejects.toThrow('selected file is empty');
		expect(ingestionMocks.loadSchema).not.toHaveBeenCalled();
	});

	it('rejects ingestion after a database or table is removed', async () => {
		ingestionMocks.loadSchema.mockResolvedValueOnce({});
		const missingDatabase = startEmulatedIngestion({
			clusterId: 'cluster',
			database: 'Analytics',
			table: 'Events',
			format: 'csv',
			source: { kind: 'inline', data: '1' }
		});
		await expect(missingDatabase.promise).rejects.toThrow('Database “Analytics” no longer exists');

		ingestionMocks.loadSchema.mockResolvedValueOnce({
			Analytics: { name: 'Analytics', tables: [], functions: [] }
		});
		const missingTable = startEmulatedIngestion({
			clusterId: 'cluster',
			database: 'Analytics',
			table: 'Events',
			format: 'csv',
			source: { kind: 'inline', data: '1' }
		});
		await expect(missingTable.promise).rejects.toThrow('Table “Events” no longer exists');
	});

	it('cancels before and after the DuckDB execution starts', async () => {
		let resolveSchema!: (schema: unknown) => void;
		ingestionMocks.loadSchema.mockReturnValueOnce(
			new Promise((resolve) => (resolveSchema = resolve))
		);
		const early = startEmulatedIngestion({
			clusterId: 'cluster',
			database: 'Analytics',
			table: 'Events',
			format: 'csv',
			source: { kind: 'inline', data: '1' }
		});
		early.cancel();
		resolveSchema({ Analytics: { name: 'Analytics', tables: [{ name: 'Events' }] } });
		await expect(early.promise).rejects.toThrow('Query cancelled.');

		const cancel = vi.fn();
		let resolveQuery!: (result: typeof baseResult) => void;
		ingestionMocks.startFileQuery.mockReturnValueOnce({
			promise: new Promise((resolve) => (resolveQuery = resolve)),
			cancel
		});
		const active = startEmulatedIngestion({
			clusterId: 'cluster',
			database: 'Analytics',
			table: 'Events',
			format: 'csv',
			source: { kind: 'inline', data: '1' }
		});
		await vi.waitFor(() => expect(ingestionMocks.startFileQuery).toHaveBeenCalled());
		active.cancel();
		expect(cancel).toHaveBeenCalledOnce();
		resolveQuery(baseResult);
		await expect(active.promise).rejects.toThrow('Query cancelled.');
	});

	it('warns when DuckDB omits the inserted row count', async () => {
		ingestionMocks.startFileQuery.mockReturnValueOnce({
			promise: Promise.resolve({ ...baseResult, columns: [], rows: [], warnings: ['existing'] }),
			cancel: vi.fn()
		});
		const result = await startEmulatedIngestion({
			clusterId: 'cluster',
			database: 'Analytics',
			table: 'Events',
			format: 'csv',
			source: { kind: 'inline', data: '1' }
		}).promise;
		expect(result.rows[0][0]).toBeNull();
		expect(result.warnings).toEqual([
			'existing',
			'DuckDB completed the ingestion without returning a row count.'
		]);
	});
});
