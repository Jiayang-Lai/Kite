export const KUSTO_TOC_URL =
	'https://raw.githubusercontent.com/MicrosoftDocs/dataexplorer-docs/refs/heads/main/data-explorer/kusto-tocs/query/toc.yml';
export const KUSTO_DOCS_SITE_BASE_URL = 'https://learn.microsoft.com/en-us/kusto/query';

const defaultRetryOptions = {
	maxRetries: 5,
	minimumRequestInterval: 50,
	baseRetryDelay: 15_000,
	maximumRetryDelay: 120_000,
	maximumJitter: 1_000
};

const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);

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

export function getDocumentationIndexStats(index) {
	const lookupKeyCount = Object.keys(index).length;
	const uniquePathCount = new Set(Object.values(index)).size;
	return {
		lookupKeyCount,
		uniquePathCount,
		aliasCount: lookupKeyCount - uniquePathCount
	};
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

export function createRateLimitedFetcher(options = {}) {
	const {
		fetchImplementation = globalThis.fetch,
		sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
		now = Date.now,
		random = Math.random,
		maxRetries = defaultRetryOptions.maxRetries,
		minimumRequestInterval = defaultRetryOptions.minimumRequestInterval,
		baseRetryDelay = defaultRetryOptions.baseRetryDelay,
		maximumRetryDelay = defaultRetryOptions.maximumRetryDelay,
		maximumJitter = defaultRetryOptions.maximumJitter
	} = options;

	let blockedUntil = 0;
	let nextRequestAt = 0;
	let previousPermit = Promise.resolve();

	async function acquirePermit() {
		let releasePermit;
		const permit = new Promise((resolve) => {
			releasePermit = resolve;
		});
		const waitForPreviousPermit = previousPermit;
		previousPermit = permit;

		await waitForPreviousPermit;
		try {
			for (;;) {
				const wait = Math.max(blockedUntil, nextRequestAt) - now();
				if (wait <= 0) {
					break;
				}
				await sleep(wait);
			}
			nextRequestAt = now() + minimumRequestInterval;
		} finally {
			releasePermit();
		}
	}

	function blockRequestsFor(milliseconds) {
		blockedUntil = Math.max(blockedUntil, now() + milliseconds);
	}

	return async function fetchWithRetry(url, progress) {
		for (let retry = 0; ; retry++) {
			await acquirePermit();

			let response;
			try {
				response = await fetchImplementation(url);
			} catch (error) {
				if (retry >= maxRetries) {
					throw error;
				}

				const { delay, source } = getRetryDelay({
					retry,
					baseRetryDelay,
					maximumRetryDelay,
					maximumJitter,
					random,
					now
				});
				blockRequestsFor(delay);
				console.warn(
					`${progress} Request failed; retrying in ${formatDuration(delay)} (${source}, attempt ${retry + 1}/${maxRetries}): ${getErrorMessage(error)}`
				);
				continue;
			}

			if (!retryableStatuses.has(response.status) || retry >= maxRetries) {
				return response;
			}
			await response.body?.cancel();

			const { delay, source } = getRetryDelay({
				retryAfter: response.headers.get('retry-after'),
				retry,
				baseRetryDelay,
				maximumRetryDelay,
				maximumJitter,
				random,
				now
			});
			blockRequestsFor(delay);
			console.warn(
				`${progress} HTTP ${response.status}; pausing all downloads for ${formatDuration(delay)} (${source}, attempt ${retry + 1}/${maxRetries}).`
			);
		}
	};
}

export const fetchWithRateLimitRetry = createRateLimitedFetcher();

function getRetryDelay({
	retryAfter,
	retry,
	baseRetryDelay,
	maximumRetryDelay,
	maximumJitter,
	random,
	now
}) {
	const exponentialDelay = Math.min(baseRetryDelay * 2 ** retry, maximumRetryDelay);
	const jitter = Math.floor(random() * maximumJitter);
	const fallback = { delay: exponentialDelay + jitter, source: 'exponential backoff' };

	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds) && seconds >= 0) {
			return {
				delay: Math.max(seconds * 1_000, exponentialDelay) + jitter,
				source: 'server Retry-After with backoff'
			};
		}

		const date = Date.parse(retryAfter);
		if (!Number.isNaN(date)) {
			return {
				delay: Math.max(0, date - now(), exponentialDelay) + jitter,
				source: 'server Retry-After with backoff'
			};
		}
	}

	return fallback;
}

function formatDuration(milliseconds) {
	return `${Math.ceil(milliseconds / 1_000)}s`;
}

function getErrorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
