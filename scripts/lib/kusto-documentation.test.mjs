import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRateLimitedFetcher } from './kusto-documentation.mjs';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('createRateLimitedFetcher', () => {
	it('uses Retry-After, exponential backoff, and jitter-free deterministic delays', async () => {
		let currentTime = 0;
		const delays = [];
		const responses = [
			new Response('', { status: 429, headers: { 'retry-after': '1' } }),
			new Response('', { status: 503 }),
			new Response('ok')
		];
		const fetchImplementation = vi.fn(async () => responses.shift());
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const fetchWithRetry = createRateLimitedFetcher({
			fetchImplementation,
			sleep: async (milliseconds) => {
				delays.push(milliseconds);
				currentTime += milliseconds;
			},
			now: () => currentTime,
			random: () => 0,
			minimumRequestInterval: 0,
			baseRetryDelay: 100,
			maximumRetryDelay: 1_000,
			maximumJitter: 0
		});

		const response = await fetchWithRetry('https://example.test/doc', '[1/1] doc.md');

		expect(await response.text()).toBe('ok');
		expect(fetchImplementation).toHaveBeenCalledTimes(3);
		expect(delays).toEqual([1_000, 200]);
	});

	it('makes later requests wait for a cooldown established by another request', async () => {
		let currentTime = 0;
		const calls = [];
		const sleepers = [];
		let firstRequest = true;
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const fetchWithRetry = createRateLimitedFetcher({
			fetchImplementation: async (url) => {
				calls.push(url);
				if (firstRequest) {
					firstRequest = false;
					return new Response('', { status: 429 });
				}
				return new Response('ok');
			},
			sleep: (milliseconds) =>
				new Promise((resolve) => {
					sleepers.push({ milliseconds, resolve });
				}),
			now: () => currentTime,
			random: () => 0,
			minimumRequestInterval: 0,
			baseRetryDelay: 100,
			maximumRetryDelay: 100,
			maximumJitter: 0
		});

		const first = fetchWithRetry('first', '[1/2] first.md');
		await waitFor(() => sleepers.length === 1);

		const second = fetchWithRetry('second', '[2/2] second.md');
		await Promise.resolve();
		expect(calls).toEqual(['first']);

		currentTime += sleepers[0].milliseconds;
		sleepers[0].resolve();
		await Promise.all([first, second]);
		expect(calls).toEqual(['first', 'first', 'second']);
	});

	it('returns the final retryable response after exhausting its retry budget', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImplementation = vi.fn(async () => new Response('', { status: 429 }));
		const fetchWithRetry = createRateLimitedFetcher({
			fetchImplementation,
			sleep: async () => {},
			now: () => 0,
			random: () => 0,
			maxRetries: 2,
			minimumRequestInterval: 0,
			baseRetryDelay: 0,
			maximumRetryDelay: 0,
			maximumJitter: 0
		});

		const response = await fetchWithRetry('https://example.test/doc', '[1/1] doc.md');

		expect(response.status).toBe(429);
		expect(fetchImplementation).toHaveBeenCalledTimes(3);
	});
});

async function waitFor(predicate) {
	for (let attempt = 0; attempt < 20; attempt++) {
		if (predicate()) {
			return;
		}
		await Promise.resolve();
	}
	throw new Error('Condition was not reached.');
}
