import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import AdminWorkspace from './admin-workspace.svelte';

describe('AdminWorkspace', () => {
	beforeEach(() => localStorage.clear());

	it('renders every administrative workspace for the ready mock cluster', async () => {
		const screen = await render(
			AdminWorkspace,
			{ view: 'overview' },
			{ wrapper: AppContextWrapper }
		);

		await expect
			.element(screen.getByRole('heading', { name: 'Operate Mock cluster' }))
			.toBeVisible();
		await expect.element(screen.getByText('Mock cluster', { exact: true }).first()).toBeVisible();

		await screen.rerender({ view: 'databases' });
		await expect
			.element(screen.getByText('Databases & tables', { exact: true }).first())
			.toBeVisible();
		await expect.element(screen.getByRole('heading', { name: 'Databases' })).toBeVisible();

		await screen.rerender({ view: 'commands' });
		await expect
			.element(screen.getByText('Management commands', { exact: true }).first())
			.toBeVisible();
		await expect.element(screen.getByText(/Run and inspect administrative/)).toBeVisible();

		await screen.rerender({ view: 'ingestion' });
		await expect.element(screen.getByText('Data ingestion', { exact: true }).first()).toBeVisible();
	});
});
