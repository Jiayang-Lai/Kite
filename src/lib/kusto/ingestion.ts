export type MountedFileFormat = 'parquet' | 'csv';

export type InlineIngestion = {
	table: string;
	data: string;
	/** Stable value used to make a file chunk safe to retry. */
	ingestBy?: string;
};

export type MountedFileIngestion = {
	table: string;
	containerRoot: string;
	relativePath: string;
	format: MountedFileFormat;
};

/** Quotes entity names only when Kusto's simple identifier syntax cannot represent them. */
export function quoteKustoEntity(name: string) {
	const entity = name.trim();
	if (!entity) throw new Error('Select a target table.');
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(entity) ? entity : `['${entity.replaceAll("'", "''")}']`;
}

/** Resolves a user-entered relative path without allowing it to leave the mounted root. */
export function resolveMountedFilePath(containerRoot: string, relativePath: string) {
	const root = containerRoot.trim().replace(/\/+$/, '');
	if (!root.startsWith('/') || root === '') {
		throw new Error('The configured Kustainer ingestion root must be an absolute path.');
	}

	const path = relativePath.trim().replaceAll('\\', '/');
	if (!path) throw new Error('Enter a file path relative to the mounted ingestion directory.');
	if (path.startsWith('/')) throw new Error('Enter a relative file path, not an absolute path.');
	if (/[\0\r\n]/.test(path)) throw new Error('The file path contains unsupported characters.');

	const segments = path.split('/');
	if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
		throw new Error(
			'The file path cannot contain empty, current-directory, or parent-directory segments.'
		);
	}

	return `${root}/${path}`;
}

function quoteVerbatimString(value: string) {
	return `@"${value.replaceAll('"', '""')}"`;
}

function quoteKustoString(value: string) {
	return `'${value.replaceAll("'", "''")}'`;
}

function buildInlineIngestionPrefix(table: string, ingestBy?: string) {
	const properties = ingestBy
		? ` with (format="csv", tags=${quoteKustoString(JSON.stringify([`ingest-by:${ingestBy}`]))}, ingestIfNotExists=${quoteKustoString(JSON.stringify([ingestBy]))})`
		: '';
	return `.ingest inline into table ${quoteKustoEntity(table)}${properties} <|\n`;
}

/** Builds a direct inline ingestion command while preserving the supplied CSV payload exactly. */
export function buildInlineIngestionCommand({ table, data, ingestBy }: InlineIngestion) {
	if (!data.trim()) throw new Error('Enter at least one CSV row to ingest.');
	return `${buildInlineIngestionPrefix(table, ingestBy)}${data}`;
}

/** Returns the safe data budget after reserving the idempotent command prefix. */
export function getInlineFilePayloadBudget(table: string, maxCommandBytes: number) {
	const representativeHash = '0'.repeat(64);
	const prefixBytes = new TextEncoder().encode(
		buildInlineIngestionPrefix(table, `kite-inline-file:${representativeHash}`)
	).byteLength;
	const safetyBytes = 256;
	const budget = maxCommandBytes - prefixBytes - safetyBytes;
	if (budget <= 0) throw new Error('The configured inline command limit is too small.');
	return budget;
}

/** Builds a Kustainer direct-ingestion command for a file already visible in its mounted volume. */
export function buildMountedFileIngestionCommand({
	table,
	containerRoot,
	relativePath,
	format
}: MountedFileIngestion) {
	if (format !== 'parquet' && format !== 'csv') {
		throw new Error('Select a supported file format.');
	}
	const sourcePath = resolveMountedFilePath(containerRoot, relativePath);
	return `.ingest into table ${quoteKustoEntity(table)}(${quoteVerbatimString(sourcePath)}) with (format="${format}")`;
}
