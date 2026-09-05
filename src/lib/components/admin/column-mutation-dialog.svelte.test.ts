import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import ColumnMutationDialog from './column-mutation-dialog.svelte';

const table = {
	name: 'Events',
	columns: [
		{ name: 'Message', type: 'string' },
		{ name: 'Count', type: 'long' }
	]
};
const baseProps = {
	open: true,
	table,
	column: table.columns[0],
	databaseName: 'Samples',
	clusterName: 'Production',
	preflightReady: true
};

describe('ColumnMutationDialog', () => {
	beforeEach(() => localStorage.clear());

	it('renames a verified column after confirmation', async () => {
		const onsubmit = vi.fn();
		const screen = await render(
			ColumnMutationDialog,
			{
				...baseProps,
				action: 'rename',
				snapshot: {
					databaseName: 'Samples',
					tableName: 'Events',
					columns: table.columns,
					docstring: '',
					tableId: 'table-1',
					totalRowCount: 1
				},
				onsubmit
			},
			{ wrapper: AppContextWrapper }
		);
		await expect.element(screen.getByRole('heading', { name: 'Rename Message' })).toBeVisible();
		await expect.element(screen.getByText(/1\s*row/)).toBeVisible();
		await screen.getByLabelText('New column name').fill('Details');
		await screen.getByLabelText(/Type RENAME/).fill('RENAME');
		await screen.getByRole('button', { name: 'Rename column' }).click();
		expect(onsubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'rename-column',
				columnName: 'Message',
				newColumnName: 'Details'
			})
		);
	});

	it('changes type and exposes the irreversible warning', async () => {
		const onsubmit = vi.fn();
		const screen = await render(
			ColumnMutationDialog,
			{ ...baseProps, action: 'change-type', onsubmit },
			{ wrapper: AppContextWrapper }
		);
		await screen.getByLabelText('New column type').click();
		await screen.getByRole('option', { name: 'long' }).click();
		await expect.element(screen.getByText(/Every existing value/)).toBeVisible();
		await screen.getByLabelText(/Type CHANGE TYPE/).fill('CHANGE TYPE Events.Message');
		await screen.getByRole('button', { name: 'Change type' }).click();
		expect(onsubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'change-column-type',
				columnName: 'Message',
				newColumnType: 'long'
			})
		);
	});

	it('drops a column and renders verification and running states', async () => {
		const onsubmit = vi.fn();
		const oncancel = vi.fn();
		const screen = await render(
			ColumnMutationDialog,
			{
				...baseProps,
				action: 'drop',
				preflightReady: false,
				executionError: 'Could not remove',
				onsubmit
			},
			{ wrapper: AppContextWrapper }
		);
		await expect.element(screen.getByText(/Schema verification is required/)).toBeVisible();
		await expect.element(screen.getByRole('alert')).toHaveTextContent('Could not remove');
		await screen.rerender({
			...baseProps,
			action: 'drop',
			isRunning: true,
			oncancel,
			onsubmit
		});
		await expect.element(screen.getByRole('button', { name: 'Removing column' })).toBeDisabled();
		await screen.getByRole('button', { name: 'Stop waiting' }).click();
		expect(oncancel).toHaveBeenCalledOnce();
	});
});
