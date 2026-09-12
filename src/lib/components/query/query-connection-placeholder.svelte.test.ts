import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import QueryConnectionPlaceholder from './query-connection-placeholder.svelte';

describe('QueryConnectionPlaceholder', () => {
	it('renders connection progress and the optional authentication guidance', async () => {
		const screen = await render(QueryConnectionPlaceholder, {
			status: 'loading',
			clusterName: 'Logs workspace',
			showSignInTip: true,
			onretry: vi.fn()
		});

		await expect.element(screen.getByText('Connecting to Logs workspace…')).toBeVisible();
		await expect.element(screen.getByText(/Microsoft Entra sign-in/)).toBeVisible();

		await screen.rerender({ showSignInTip: false });
		await expect.element(screen.getByText(/Microsoft Entra sign-in/)).not.toBeInTheDocument();
	});

	it('renders the connection failure and retries it', async () => {
		const onretry = vi.fn();
		const screen = await render(QueryConnectionPlaceholder, {
			status: 'error',
			clusterName: 'Broken cluster',
			error: 'Network unavailable',
			onretry
		});

		await expect
			.element(screen.getByRole('heading', { name: 'Could not connect to Kusto' }))
			.toBeVisible();
		await expect.element(screen.getByText('Network unavailable')).toBeVisible();
		await screen.getByRole('button', { name: 'Retry' }).click();
		expect(onretry).toHaveBeenCalledOnce();
	});
});
