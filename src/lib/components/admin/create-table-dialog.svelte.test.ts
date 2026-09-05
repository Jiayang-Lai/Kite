import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import CreateTableDialog from './create-table-dialog.svelte';

describe('CreateTableDialog', () => {
	beforeEach(() => localStorage.clear());

	it('builds, reviews, confirms, and submits a table plan', async () => {
		const onsubmit = vi.fn();
		const screen = await render(
			CreateTableDialog,
			{
				open: true,
				databaseName: 'Samples',
				clusterName: 'Mock cluster',
				existingTableNames: ['Existing'],
				onsubmit
			},
			{ wrapper: AppContextWrapper }
		);

		await expect.element(screen.getByRole('heading', { name: 'New table' })).toBeVisible();
		await screen.getByLabelText('Table name').fill('Events');
		await screen.getByLabelText('Description (optional)', { exact: true }).fill('Incoming events');
		await screen.getByLabelText('Folder (optional)').fill('Operations');
		await screen.getByLabelText('Column name').fill('Message');
		await screen.getByLabelText('Column description (optional)').fill('Event body');
		await screen.getByRole('button', { name: 'Add column' }).click();
		await screen.getByLabelText('Column name').nth(1).fill('Count');
		await screen.getByRole('button', { name: 'Review table' }).click();
		await expect.element(screen.getByRole('heading', { name: 'Review new table' })).toBeVisible();
		await expect.element(screen.getByText(/2\s*columns/)).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Create table' })).toBeDisabled();
		await screen.getByLabelText(/Type CREATE Events/).fill('CREATE Events');
		await screen.getByRole('button', { name: 'Create table' }).click();
		expect(onsubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				tableName: 'Events',
				columns: [
					{ name: 'Message', type: 'string', docstring: 'Event body' },
					{ name: 'Count', type: 'string' }
				]
			})
		);
	});

	it('reports invalid drafts and renders execution states', async () => {
		const oncancel = vi.fn();
		const screen = await render(
			CreateTableDialog,
			{
				open: true,
				databaseName: 'Samples',
				clusterName: 'Mock cluster',
				existingTableNames: ['Events'],
				executionError: 'Creation failed',
				oncancel
			},
			{ wrapper: AppContextWrapper }
		);
		await screen.getByLabelText('Table name').fill('Events');
		await screen.getByLabelText('Column name').fill('Message');
		await expect.element(screen.getByText(/already exists/)).toBeVisible();
		await expect.element(screen.getByRole('alert')).toHaveTextContent('Creation failed');
		await screen.rerender({
			open: true,
			databaseName: 'Samples',
			clusterName: 'Mock cluster',
			existingTableNames: [],
			isRunning: true,
			oncancel
		});
		await expect.element(screen.getByRole('button', { name: 'Creating table' })).toBeDisabled();
		await screen.getByRole('button', { name: 'Stop waiting' }).click();
		expect(oncancel).toHaveBeenCalledOnce();
	});
});
