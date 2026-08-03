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

const downloadedPaths = new Set();

async function downloadDocumentation(path, index, total, phase = '') {
	const documentationUrl = `${KUSTO_DOCS_SITE_BASE_URL}/${path}?view=microsoft-fabric&accept=text/markdown`;
	const progress = `${phase}[${index + 1}/${total}]`;
	console.log(`${progress} Downloading: ${path}.md (${documentationUrl})`);
	const response = await fetchWithRateLimitRetry(documentationUrl, `${progress} ${path}.md`);
	if (!response.ok) {
		throw new Error(`Unable to fetch ${path}: ${response.status} ${response.statusText}`);
	}

	const outputFile = resolve(documentationFolder, `${path}.md`);
	await mkdir(dirname(outputFile), { recursive: true });
	await writeFile(outputFile, await response.text());
	downloadedPaths.add(path);
}

async function downloadBatch(paths, limit, phase = '') {
	const failures = [];
	await mapWithConcurrency(paths, limit, async (path, index) => {
		try {
			await downloadDocumentation(path, index, paths.length, phase);
		} catch (error) {
			failures.push({ path, error });
			console.warn(
				`${phase}[${index + 1}/${paths.length}] Deferred ${path}.md: ${getErrorMessage(error)}`
			);
		}
	});
	return failures;
}

const initialFailures = await downloadBatch(documentationPathsToDownload, concurrency);
let finalFailures = initialFailures;

if (initialFailures.length > 0) {
	const recoveryPaths = initialFailures.map(({ path }) => path);
	console.warn(
		`Retrying ${recoveryPaths.length} deferred Kusto document${recoveryPaths.length === 1 ? '' : 's'} sequentially after the main queue.`
	);
	finalFailures = await downloadBatch(recoveryPaths, 1, '[recovery] ');
}

if (finalFailures.length > 0) {
	const failureSummary = finalFailures
		.map(({ path, error }) => `- ${path}.md: ${getErrorMessage(error)}`)
		.join('\n');
	throw new Error(
		`Downloaded ${downloadedPaths.size} of ${documentationPathsToDownload.length} requested Kusto documents. Failed after recovery:\n${failureSummary}`
	);
}

if (documentationPathsToDownload.length === 0 && !forceRefetch) {
	console.log(
		`Kusto documentation cache hit: all ${uniquePathCount} unique Markdown files already exist for ${lookupKeyCount} lookup keys (${aliasCount} aliases).`
	);
} else {
	console.log(
		`Downloaded ${documentationPathsToDownload.length} of ${uniquePathCount} unique Kusto Markdown files for ${lookupKeyCount} lookup keys (${aliasCount} aliases)${forceRefetch ? ' (forced)' : ''}.`
	);
}

function getErrorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
