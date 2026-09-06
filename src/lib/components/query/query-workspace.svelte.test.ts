import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import QueryWorkspaceWrapper from '../../../../tests/fixtures/query-workspace-wrapper.svelte';
import QueryWorkspace from './query-workspace.svelte';

describe('QueryWorkspace', () => {
	it('renders its lazily loaded overview and saved-query views', async () => {
		const screen = await render(
			QueryWorkspace,
			{ view: 'overview' },
			{
				wrapper: QueryWorkspaceWrapper
			}
		);

		await expect.element(screen.getByText('Explore Mock cluster')).toBeVisible();
		await expect.element(screen.getByText('Search the cluster schema')).toBeVisible();

		await screen.rerender({ view: 'saved-queries' });
		await expect.element(screen.getByText('Saved queries')).toBeVisible();
	});

	it('opens and validates the save-query dialog from the editor', async () => {
		const screen = await render(
			QueryWorkspace,
			{ view: 'editor' },
			{
				wrapper: QueryWorkspaceWrapper
			}
		);

		const saveButton = screen.getByTitle('Save query locally');
		await expect.element(saveButton).toBeInTheDocument();
		(saveButton.element() as HTMLButtonElement).click();
		await expect.element(screen.getByRole('heading', { name: 'Save query' })).toBeVisible();
		await screen.getByRole('button', { name: 'Save query' }).click();
		await expect.element(screen.getByText('Enter a name for this query.')).toBeVisible();

		await screen.getByLabelText('Query name').fill('Event count');
		await screen.getByRole('button', { name: 'Save query' }).click();
		await expect
			.element(screen.getByRole('heading', { name: 'Save query' }))
			.not.toBeInTheDocument();
	});

	it('switches clusters through the shared connection lifecycle', async () => {
		vi.spyOn(window, 'confirm').mockReturnValue(true);
		const screen = await render(
			QueryWorkspace,
			{ view: 'overview' },
			{ wrapper: QueryWorkspaceWrapper }
		);

		await screen.getByRole('button', { name: 'Toggle cluster explorer' }).click();
		const clusterLabel = screen.getByTitle('Mock cluster');
		await expect.element(clusterLabel).toBeVisible();
		const clusterSelector = clusterLabel.element().closest('button');
		expect(clusterSelector).not.toBeNull();
		clusterSelector?.click();
		await screen.getByRole('menuitem', { name: /Emulated cluster/ }).click();

		await expect.element(screen.getByText('Explore Emulated cluster')).toBeVisible();
	});
});
