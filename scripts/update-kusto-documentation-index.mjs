import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	createDocumentationIndex,
	fetchWithRateLimitRetry,
	getDocumentationIndexStats,
	KUSTO_TOC_URL
} from './lib/kusto-documentation.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = resolve(projectRoot, 'data/kusto-documentation-index.json');

console.log(`[TOC] Downloading: ${KUSTO_TOC_URL}`);
const response = await fetchWithRateLimitRetry(KUSTO_TOC_URL, '[TOC]');
if (!response.ok) {
	throw new Error(
		`Unable to fetch the Kusto documentation TOC: ${response.status} ${response.statusText}`
	);
}

const index = createDocumentationIndex(await response.text());
await mkdir(dirname(snapshotPath), { recursive: true });
await writeFile(snapshotPath, `${JSON.stringify(index, null, '\t')}\n`);

const { lookupKeyCount, uniquePathCount, aliasCount } = getDocumentationIndexStats(index);
console.log(
	`Updated ${snapshotPath.replace(`${projectRoot}/`, '')}: ${lookupKeyCount} lookup keys resolve to ${uniquePathCount} unique documentation paths (${aliasCount} aliases).`
);
