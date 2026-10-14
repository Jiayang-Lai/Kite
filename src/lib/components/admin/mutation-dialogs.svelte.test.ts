import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import DatabaseMutationDialog from './database-mutation-dialog.svelte';
import TableDropDialog from './table-drop-dialog.svelte';

describe('database and table mutation dialogs', () => {
	beforeEach(() => localStorage.clear());

	it('creates and renames databases', async () => {
		const onsubmit = vi.fn();
		const screen = await render(
			DatabaseMutationDialog,
			{ open: true, action: 'create', clusterKind: 'emulated', onsubmit },
			{ wrapper: AppContextWrapper }
		);
		await expect.element(screen.getByText(/attached DuckDB database/)).toBeVisible();
		await screen.getByLabelText('Database name').fill('Analytics');
		await screen.getByRole('button', { name: 'Create database' }).click();
		expect(onsubmit).toHaveBeenCalledWith({ name: 'Analytics' });

		await screen.rerender({
			open: true,
			action: 'rename',
			databaseName: 'Analytics',
			initialName: 'Friendly Analytics',
			clusterKind: 'remote',
			renameMode: 'display-name',
			onsubmit
		});
		await expect
			.element(screen.getByRole('heading', { name: 'Edit database display name' }))
			.toBeVisible();
		await expect
			.element(screen.getByLabelText('Display name', { exact: true }))
			.toHaveValue('Friendly Analytics');
		await expect.element(screen.getByText(/friendly display name/)).toBeVisible();
	});

	it('requires confirmation to delete each database backend', async () => {
		const onsubmit = vi.fn();
		const screen = await render(
			DatabaseMutationDialog,
			{ open: true, action: 'drop', databaseName: 'Analytics', clusterKind: 'mock', onsubmit },
			{ wrapper: AppContextWrapper }
		);
		for (const clusterKind of ['mock', 'emulated', 'remote'] as const) {
			await screen.rerender({
				open: true,
				action: 'drop',
				databaseName: 'Analytics',
				clusterKind,
				onsubmit
			});
			await expect.element(screen.getByRole('button', { name: 'Delete database' })).toBeDisabled();
			await screen.getByLabelText('Type Analytics to confirm').fill('Analytics');
			await screen.getByRole('button', { name: 'Delete database' }).click();
		}
		expect(onsubmit).toHaveBeenCalledTimes(3);
		expect(onsubmit).toHaveBeenLastCalledWith({ name: undefined });
	});

	it('confirms table deletion and reports async errors', async () => {
		const onsubmit = vi.fn().mockRejectedValueOnce(new Error('Delete failed'));
		const screen = await render(
			TableDropDialog,
			{
				open: true,
				databaseName: 'Samples',
				tableName: 'Events',
				clusterKind: 'remote',
				onsubmit
			},
			{ wrapper: AppContextWrapper }
		);
		await expect.element(screen.getByText(/Permanently delete Samples.Events/)).toBeVisible();
		await screen.getByLabelText('Type REMOVE Events to confirm').fill('REMOVE Events');
		await screen.getByRole('button', { name: 'Remove table' }).click();
		await expect.element(screen.getByRole('alert')).toHaveTextContent('Delete failed');
	});
});
