import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { KustoClusterConnection } from '$lib/kusto/query-client';
import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import ManageClustersDialog from './manage-clusters-dialog.svelte';
import RemoveClusterDialog from './remove-cluster-dialog.svelte';

const remote: KustoClusterConnection = {
	id: 'remote',
	name: 'Remote cluster',
	kind: 'remote',
	url: 'https://example.kusto.windows.net',
	description: 'Production'
};
const memory: KustoClusterConnection = {
	id: 'memory',
	name: 'Memory cluster',
	kind: 'emulated',
	url: 'emulated://kite/memory',
	emulatedStorage: { mode: 'memory' }
};
const persistent: KustoClusterConnection = {
	...memory,
	id: 'persistent',
	name: 'Persistent cluster',
	emulatedStorage: { mode: 'opfs', storageId: 'persistent', formatVersion: 1 }
};

describe('cluster management dialogs', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => vi.useRealTimers());

	it('renders empty and populated management states and edits a connection', async () => {
		const onedit = vi.fn();
		const screen = await render(
			ManageClustersDialog,
			{ open: true, clusters: [], selectedClusterId: '', onedit },
			{ wrapper: AppContextWrapper }
		);
		await expect
			.element(screen.getByText('No browser-local clusters have been added.'))
			.toBeVisible();

		await screen.rerender({
			open: true,
			clusters: [remote, memory],
			selectedClusterId: 'memory',
			onedit
		});
		await expect.element(screen.getByText('Current')).toBeVisible();
		await screen.getByRole('button', { name: 'Edit Remote cluster' }).click();
		await expect
			.element(screen.getByRole('heading', { name: 'Edit Remote cluster' }))
			.toBeVisible();
		await screen.getByLabelText('Name').fill('Renamed cluster');
		await screen.getByRole('button', { name: 'Save changes' }).click();
		expect(onedit).toHaveBeenCalledWith(
			'remote',
			expect.objectContaining({ name: 'Renamed cluster', kind: 'remote' })
		);
	});

	it('forwards a removal after closing management', async () => {
		vi.useFakeTimers();
		const onremove = vi.fn();
		const screen = await render(
			ManageClustersDialog,
			{ open: true, clusters: [remote], selectedClusterId: '', onremove },
			{ wrapper: AppContextWrapper }
		);
		await screen.getByRole('button', { name: 'Remove Remote cluster' }).click();
		await vi.runAllTimersAsync();
		expect(onremove).toHaveBeenCalledWith(remote);
	});

	it('describes and confirms memory and persistent cluster removal', async () => {
		const onconfirm = vi.fn();
		const screen = await render(
			RemoveClusterDialog,
			{ open: true, cluster: memory, isCurrent: false, onconfirm },
			{ wrapper: AppContextWrapper }
		);
		await expect.element(screen.getByText(/releases its in-memory DuckDB databases/)).toBeVisible();
		await expect
			.element(screen.getByText('Kite will not switch clusters after removal.'))
			.toBeVisible();
		await screen.getByRole('button', { name: 'Remove cluster' }).click();
		expect(onconfirm).toHaveBeenCalledWith('memory');

		await screen.rerender({ open: true, cluster: persistent, isCurrent: true, onconfirm });
		await expect.element(screen.getByText(/permanently removes the connection/)).toBeVisible();
		await expect.element(screen.getByText(/switch to the Mock cluster/)).toBeVisible();
	});
});
