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

	it('switches clusters through the shared connection lifecycle', async () => {
		const screen = await render(
			AdminWorkspace,
			{ view: 'overview' },
			{ wrapper: AppContextWrapper }
		);

		await screen.getByRole('button', { name: 'Toggle admin navigation' }).click();
		const clusterLabel = screen.getByTitle('Mock cluster');
		await expect.element(clusterLabel).toBeVisible();
		const clusterSelector = clusterLabel.element().closest('button');
		expect(clusterSelector).not.toBeNull();
		clusterSelector?.click();
		await screen.getByRole('menuitem', { name: /Emulated cluster/ }).click();

		await expect
			.element(screen.getByRole('heading', { name: 'Operate Emulated cluster' }))
			.toBeVisible();
	});
});
