import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { MOCK_DATABASES } from '$lib/data/mock-databases';
import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import DatabaseExplorer from './database-explorer.svelte';

const expansionState = {
	databases: { Samples: true },
	groups: { 'Samples:tables': true, 'Samples:functions': true },
	schemaTables: {},
	sections: { 'saved-queries': true, 'recent-queries': true }
} as const;

describe('DatabaseExplorer', () => {
	beforeEach(() => localStorage.clear());

	it('filters and selects schema objects and queries', async () => {
		const onexpansionchange = vi.fn();
		const onselectionchange = vi.fn();
		const onqueryselect = vi.fn();
		const screen = await render(
			DatabaseExplorer,
			{
				databases: MOCK_DATABASES,
				selectedDatabase: 'Samples',
				expansionState,
				onexpansionchange,
				onselectionchange,
				onqueryselect,
				savedQueries: [
					{ id: 'saved-1', name: 'Saved storms', database: 'Samples', query: 'StormEvents' }
				],
				recentQueries: [
					{ id: 'recent-1', name: 'Recent apps', database: 'Telemetry', query: 'AppRequests' }
				]
			},
			{ wrapper: AppContextWrapper }
		);

		await expect.element(screen.getByLabelText(/Search databases/)).toBeVisible();
		await expect.element(screen.getByText('Saved storms')).toBeVisible();
		await screen.getByRole('button', { name: 'Saved storms Samples' }).click();
		expect(onqueryselect).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'saved-1', query: 'StormEvents' })
		);

		await screen.getByLabelText(/Search databases/).fill('StormEvents');
		await expect.element(screen.getByText('No saved queries found.')).toBeVisible();
		await expect.element(screen.getByText('No recent queries found.')).toBeVisible();
		await expect.element(screen.getByText('Samples', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Telemetry', { exact: true })).not.toBeInTheDocument();
	});

	it('renders loading, empty, and hidden-cluster states', async () => {
		const onexpansionchange = vi.fn();
		const screen = await render(
			DatabaseExplorer,
			{
				connectionStatus: 'loading',
				showCluster: true,
				clusterDisabled: true,
				selectedDatabase: '',
				expansionState: {
					databases: {},
					groups: {},
					schemaTables: {},
					sections: { 'saved-queries': false, 'recent-queries': false }
				},
				onexpansionchange
			},
			{ wrapper: AppContextWrapper }
		);

		await expect
			.element(screen.getByLabelText('Cluster explorer'))
			.toHaveAttribute('aria-busy', 'true');
		await expect.element(screen.getByLabelText(/Search databases/)).toBeDisabled();
		await expect.element(screen.getByText('No databases found.')).toBeVisible();
		await screen.rerender({
			connectionStatus: 'error',
			showCluster: false,
			clusterDisabled: false,
			selectedDatabase: '',
			expansionState: {
				databases: {},
				groups: {},
				schemaTables: {},
				sections: { 'saved-queries': false, 'recent-queries': false }
			},
			onexpansionchange
		});
		await expect.element(screen.getByLabelText(/Search databases/)).not.toBeInTheDocument();
		await expect.element(screen.getByText('Admin', { exact: true })).toBeVisible();
	});
});
