import { startDuckDbFileQuery, type DuckDbRegisteredFileSource } from '$lib/duckdb/lazy-client';
import { loadEmulatedSchema, quoteDuckDbIdentifier } from '$lib/emulation/cluster';
import type { QueryExecution, QueryResult } from '$lib/types/query-result';

export type EmulatedIngestionFormat = 'csv' | 'parquet';

export type EmulatedIngestionSource =
	{ kind: 'inline'; data: string } | { kind: 'file'; file: File } | { kind: 'remote'; url: string };

export type EmulatedIngestionRequest = {
	clusterId: string;
	database: string;
	table: string;
	format: EmulatedIngestionFormat;
	hasHeader?: boolean;
	source: EmulatedIngestionSource;
};

function quoteDuckDbString(value: string) {
	return `'${value.replaceAll("'", "''")}'`;
}

function qualifiedTable(database: string, table: string) {
	return `${quoteDuckDbIdentifier(database)}.main.${quoteDuckDbIdentifier(table)}`;
}

export function resolveEmulatedRemoteUrl(value: string) {
	const input = value.trim();
	if (!input || /[\0\r\n]/.test(input)) throw new Error('Enter a valid remote file URL.');

	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new Error('Enter a valid remote file URL.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Remote file URLs must use HTTP or HTTPS.');
	}
	if (!url.hostname || url.hash || url.username || url.password) {
		throw new Error('Enter a remote URL without a fragment or embedded credentials.');
	}
	return url.toString();
}

export function describeEmulatedRemoteUrl(value: string) {
	const url = new URL(resolveEmulatedRemoteUrl(value));
	return `${url.origin}${url.pathname}${url.search ? '?…' : ''}`;
}

export function buildEmulatedIngestionSql(
	database: string,
	table: string,
	virtualPath: string,
	format: EmulatedIngestionFormat,
	hasHeader = false
) {
	const source =
		format === 'csv'
			? `read_csv(${quoteDuckDbString(virtualPath)}, header = ${hasHeader}, auto_detect = true)`
			: `read_parquet(${quoteDuckDbString(virtualPath)})`;
	return `INSERT INTO ${qualifiedTable(database, table)} SELECT * FROM ${source}`;
}

function prepareSource(request: EmulatedIngestionRequest): {
	file: DuckDbRegisteredFileSource;
	label: string;
} {
	switch (request.source.kind) {
		case 'inline':
			if (request.format !== 'csv') throw new Error('Inline ingestion accepts CSV data only.');
			if (!request.source.data.trim()) throw new Error('Enter at least one CSV row to ingest.');
			return { file: { kind: 'text', text: request.source.data }, label: 'Inline CSV' };
		case 'file':
			if (!request.source.file.size) throw new Error('The selected file is empty.');
			return {
				file: { kind: 'file', file: request.source.file },
				label: request.source.file.name
			};
		case 'remote': {
			const url = resolveEmulatedRemoteUrl(request.source.url);
			return {
				file: { kind: 'url', url },
				label: describeEmulatedRemoteUrl(url)
			};
		}
	}
}

function summarizeResult(
	result: QueryResult,
	request: EmulatedIngestionRequest,
	sourceLabel: string
): QueryResult {
	const countColumn = result.columns.findIndex((column) => column.name.toLowerCase() === 'count');
	const rowsInserted =
		countColumn >= 0 && result.rows[0]
			? result.rows[0][countColumn]
			: (result.rows[0]?.[0] ?? null);

	return {
		columns: [
			{ name: 'RowsInserted', type: 'BIGINT' },
			{ name: 'Database', type: 'VARCHAR' },
			{ name: 'Table', type: 'VARCHAR' },
			{ name: 'Source', type: 'VARCHAR' }
		],
		rows: [[rowsInserted, request.database, request.table, sourceLabel]],
		totalRowCount: 1,
		renderedRowCount: 1,
		warnings:
			rowsInserted == null
				? [...result.warnings, 'DuckDB completed the ingestion without returning a row count.']
				: result.warnings,
		elapsedMs: result.elapsedMs,
		clientRequestId: result.clientRequestId
	};
}

/** Starts one atomic append into an existing table in an emulated DuckDB cluster. */
export function startEmulatedIngestion(request: EmulatedIngestionRequest): QueryExecution {
	let cancelled = false;
	let activeExecution: QueryExecution | undefined;

	const promise = (async () => {
		const source = prepareSource(request);
		const schema = await loadEmulatedSchema(request.clusterId);
		if (cancelled) throw new Error('Query cancelled.');
		const database = schema[request.database];
		if (!database) throw new Error(`Database “${request.database}” no longer exists.`);
		if (!database.tables.some((table) => table.name === request.table)) {
			throw new Error(`Table “${request.table}” no longer exists in ${request.database}.`);
		}

		const execution = startDuckDbFileQuery({
			sessionId: request.clusterId,
			source: source.file,
			fileExtension: request.format,
			buildSql: (virtualPath) =>
				buildEmulatedIngestionSql(
					request.database,
					request.table,
					virtualPath,
					request.format,
					request.hasHeader
				)
		});
		activeExecution = execution;
		if (cancelled) execution.cancel();
		const result = await execution.promise;
		return summarizeResult(result, request, source.label);
	})();

	return {
		promise,
		cancel() {
			cancelled = true;
			activeExecution?.cancel();
		}
	};
}
