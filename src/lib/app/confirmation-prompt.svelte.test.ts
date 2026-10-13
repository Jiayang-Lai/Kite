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
});
