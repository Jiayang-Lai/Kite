export const KUSTO_TOC_URL =
	'https://raw.githubusercontent.com/MicrosoftDocs/dataexplorer-docs/refs/heads/main/data-explorer/kusto-tocs/query/toc.yml';
export const KUSTO_DOCS_SITE_BASE_URL = 'https://learn.microsoft.com/en-us/kusto/query';

const maxRateLimitRetries = 3;

export function createDocumentationIndex(toc) {
	const index = {};
	let currentName = '';
	for (const line of toc.split('\n')) {
		const nameMatch = line.match(/^\s*-\s+name:\s+(.+)$/);
		if (nameMatch) {
			currentName = nameMatch[1].trim();
			continue;
		}

		const hrefMatch = line.match(/^\s*href:\s+(\/kusto\/query\/[^\s?]+)/);
		if (!hrefMatch || !currentName) {
			continue;
		}

		const path = hrefMatch[1].replace('/kusto/query/', '');
		if (!/(?:-operator|-function)$/.test(path)) {
			continue;
		}

		const label = currentName
			.toLowerCase()
			.replace(/\(\)/g, '')
			.replace(/\s+(?:operator|function)$/, '');
		if (/^[a-z0-9_-]+$/.test(label)) {
			index[label] = path;
		}

		// Retain the filename-derived key when it differs from the completion label.
		index[path.replace(/-(?:operator|function)$/, '')] ??= path;
	}

	return validateDocumentationIndex(
		Object.fromEntries(Object.entries(index).sort(([left], [right]) => left.localeCompare(right)))
	);
}

export function validateDocumentationIndex(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The Kusto documentation index must be an object.');
	}

	for (const [label, path] of Object.entries(value)) {
		if (!/^[a-z0-9_-]+$/.test(label)) {
			throw new TypeError(`Invalid Kusto documentation label: ${label}`);
		}
		if (typeof path !== 'string' || !/^[a-z0-9][a-z0-9-]*(?:-operator|-function)$/.test(path)) {
			throw new TypeError(`Invalid Kusto documentation path for ${label}: ${String(path)}`);
		}
	}

	return value;
}

export async function mapWithConcurrency(items, limit, callback) {
	let nextIndex = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			const item = items[index];
			if (!item) {
				return;
			}

			await callback(item, index);
		}
	});

	await Promise.all(workers);
}

export async function fetchWithRateLimitRetry(url, progress) {
	for (let retry = 0; ; retry++) {
		const response = await fetch(url);
		if (response.status !== 429) {
			return response;
		}

		if (retry >= maxRateLimitRetries) {
			return response;
		}

		const { delay, source } = getRetryDelay(response.headers.get('retry-after'));
		console.warn(
			`${progress} Rate limited; retrying in ${formatDuration(delay)} (${source}, attempt ${retry + 1}/${maxRateLimitRetries}).`
		);
		await new Promise((resolve) => setTimeout(resolve, delay));
	}
}

function getRetryDelay(retryAfter) {
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds) && seconds >= 0) {
			return { delay: seconds * 1_000, source: 'server Retry-After' };
		}

		const date = Date.parse(retryAfter);
		if (!Number.isNaN(date)) {
			return { delay: Math.max(0, date - Date.now()), source: 'server Retry-After' };
		}
	}

	return { delay: 30_000, source: 'default wait' };
}

function formatDuration(milliseconds) {
	return `${Math.ceil(milliseconds / 1_000)}s`;
}
