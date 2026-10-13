import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { createConfirmationPrompt } from '$lib/app/confirmation-prompt.svelte';
import ConfirmationPromptDialog from './confirmation-prompt-dialog.svelte';

describe('ConfirmationPromptDialog', () => {
	it('keeps a follow-up question open after the first one is confirmed', async () => {
		const prompt = createConfirmationPrompt();
		const screen = await render(ConfirmationPromptDialog, { prompt });

		// Mirrors closing a running, unsaved tab: the second question is asked as soon as the
		// first resolves, before the first dialog finishes closing.
		const answers = prompt
			.ask({ title: 'Cancel running query?', description: 'Stop it.', actionLabel: 'Stop' })
			.then(async (first) => [
				first,
				await prompt.ask({
					title: 'Close tab?',
					description: 'Text is lost.',
					actionLabel: 'Close tab'
				})
			]);

		await screen.getByRole('button', { name: 'Stop' }).click();
		await expect.element(screen.getByText('Close tab?')).toBeVisible();
		expect(prompt.request?.title).toBe('Close tab?');

		await screen.getByRole('button', { name: 'Close tab' }).click();
		await expect(answers).resolves.toEqual([true, true]);
	});

	it('declines the request when cancelled', async () => {
		const prompt = createConfirmationPrompt();
		const screen = await render(ConfirmationPromptDialog, { prompt });
		const answer = prompt.ask({
			title: 'Switch?',
			description: 'Tabs close.',
			actionLabel: 'Switch'
		});

		await screen.getByRole('button', { name: 'Cancel' }).click();
		await expect(answer).resolves.toBe(false);
	});
});
