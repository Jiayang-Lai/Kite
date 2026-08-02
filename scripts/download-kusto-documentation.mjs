import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	fetchWithRateLimitRetry,
	getDocumentationIndexStats,
	KUSTO_DOCS_SITE_BASE_URL,
	mapWithConcurrency,
	validateDocumentationIndex
} from './lib/kusto-documentation.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = resolve(projectRoot, 'data/kusto-documentation-index.json');
const documentationFolder = resolve(projectRoot, 'static/kusto-docs');
const concurrency = 5;
const forceRefetch = process.argv
	.slice(2)
	.some((argument) => argument === '--force' || argument === '-f');
const index = validateDocumentationIndex(JSON.parse(await readFile(snapshotPath, 'utf8')));
const { lookupKeyCount, uniquePathCount, aliasCount } = getDocumentationIndexStats(index);
const documentationPaths = [...new Set(Object.values(index))].sort();
const documentationPathsToDownload = [];

for (const path of documentationPaths) {
	if (forceRefetch) {
		documentationPathsToDownload.push(path);
		continue;
	}

	try {
		await access(resolve(documentationFolder, `${path}.md`));
	} catch {
		documentationPathsToDownload.push(path);
	}
}

await mapWithConcurrency(documentationPathsToDownload, concurrency, async (path, index) => {
	const documentationUrl = `${KUSTO_DOCS_SITE_BASE_URL}/${path}?view=microsoft-fabric&accept=text/markdown`;
	const progress = `[${index + 1}/${documentationPathsToDownload.length}]`;
	console.log(`${progress} Downloading: ${path}.md (${documentationUrl})`);
	const response = await fetchWithRateLimitRetry(documentationUrl, `${progress} ${path}.md`);
	if (!response.ok) {
		throw new Error(`Unable to fetch ${path}: ${response.status} ${response.statusText}`);
	}

	const outputFile = resolve(documentationFolder, `${path}.md`);
	await mkdir(dirname(outputFile), { recursive: true });
	await writeFile(outputFile, await response.text());
});

if (documentationPathsToDownload.length === 0 && !forceRefetch) {
	console.log(
		`Kusto documentation cache hit: all ${uniquePathCount} unique Markdown files already exist for ${lookupKeyCount} lookup keys (${aliasCount} aliases).`
	);
} else {
	console.log(
		`Downloaded ${documentationPathsToDownload.length} of ${uniquePathCount} unique Kusto Markdown files for ${lookupKeyCount} lookup keys (${aliasCount} aliases)${forceRefetch ? ' (forced)' : ''}.`
	);
}
