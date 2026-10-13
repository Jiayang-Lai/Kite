import { describe, expect, it } from 'vitest';

import { createConfirmationPrompt } from './confirmation-prompt.svelte';

const request = {
	title: 'Close tab?',
	description: 'Its text will be lost.',
	actionLabel: 'Close'
};

describe('confirmation prompt', () => {
	it('exposes the pending request and resolves with the response', async () => {
		const prompt = createConfirmationPrompt();
		const confirmed = prompt.ask(request);
		expect(prompt.request).toEqual(request);

		prompt.respond(true);

		await expect(confirmed).resolves.toBe(true);
		expect(prompt.request).toBeUndefined();
	});

	it('declines an earlier request when a newer one is asked', async () => {
		const prompt = createConfirmationPrompt();
		const first = prompt.ask(request);
		const second = prompt.ask({ ...request, title: 'Switch connection?' });

		await expect(first).resolves.toBe(false);
		expect(prompt.request?.title).toBe('Switch connection?');
		prompt.respond(false);
		await expect(second).resolves.toBe(false);
	});

	it('ignores a late response for a request that was already answered', async () => {
		const prompt = createConfirmationPrompt();
		const firstRequest = { ...request };
		const first = prompt.ask(firstRequest);
		prompt.respond(true, firstRequest);
		await expect(first).resolves.toBe(true);

		const secondRequest = { ...request, title: 'Cancel running query?' };
		const second = prompt.ask(secondRequest);
		prompt.respond(false, firstRequest);
		expect(prompt.request).toBe(secondRequest);

		prompt.respond(true, secondRequest);
		await expect(second).resolves.toBe(true);
	});
});
