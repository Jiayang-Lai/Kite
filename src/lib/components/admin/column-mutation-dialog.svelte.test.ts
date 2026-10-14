import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import ColumnMutationDialog from './column-mutation-dialog.svelte';

const table = {
	name: 'Events',
	columns: [
		{ name: 'Message', type: 'string', docstring: 'Log text' },
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

	it('renames a verified column after confirmation and keeps its description', async () => {
		const onsubmit = vi.fn();
		const screen = await render(
			ColumnMutationDialog,
			{
				...baseProps,
				action: 'edit',
				snapshot: {
					databaseName: 'Samples',
					tableName: 'Events',
					columns: table.columns.map((column) => ({
						...column,
						docstring: column.docstring ?? ''
					})),
					docstring: '',
					tableId: 'table-1',
					totalRowCount: 1
				},
				onsubmit
			},
			{ wrapper: AppContextWrapper }
		);
		await expect.element(screen.getByRole('heading', { name: 'Edit Message' })).toBeVisible();
		await expect.element(screen.getByText(/1\s*row/)).toBeVisible();
		await expect.element(screen.getByLabelText('Column name')).toHaveValue('Message');
		await expect.element(screen.getByLabelText(/Description/)).toHaveValue('Log text');
		await screen.getByLabelText('Column name').fill('Details');
		await expect.element(screen.getByText('Breaking change')).toBeVisible();
		await expect.element(screen.getByText('Dependent references are not rewritten')).toBeVisible();
		await screen.getByLabelText(/Type RENAME/).fill('RENAME');
		await screen.getByRole('button', { name: 'Save column' }).click();
		expect(onsubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'edit-column',
				columnName: 'Message',
				newColumnName: 'Details',
				renames: true,
				updatesDocstring: false
			})
		);
	});

	it('changes only the description as a safe edit confirmed with RUN', async () => {
		const onsubmit = vi.fn();
		const screen = await render(
			ColumnMutationDialog,
			{ ...baseProps, action: 'edit', onsubmit },
			{ wrapper: AppContextWrapper }
		);
		await screen.getByLabelText(/Description/).fill('Free-form log text');
		await expect.element(screen.getByText('Safe')).toBeVisible();
		await expect
			.element(screen.getByText('Dependent references are not rewritten'))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByText(/column-docstrings \(Message:'Free-form log text'\)/))
			.toBeVisible();
		await screen.getByLabelText(/Type RUN/).fill('RUN');
		await screen.getByRole('button', { name: 'Save column' }).click();
		expect(onsubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'edit-column',
				renames: false,
				updatesDocstring: true,
				nextDocstring: 'Free-form log text'
			})
		);
	});

	it('describes a column that had no description, and shows progress while saving', async () => {
		const onsubmit = vi.fn();
		const screen = await render(
			ColumnMutationDialog,
			{ ...baseProps, action: 'edit', column: table.columns[1], onsubmit },
			{ wrapper: AppContextWrapper }
		);
		await expect.element(screen.getByLabelText(/Description/)).toHaveValue('');
		await expect.element(screen.getByRole('button', { name: 'Save column' })).toBeDisabled();
		await screen.getByLabelText(/Description/).fill('Number of events');
		await screen.getByLabelText(/Type RUN/).fill('RUN');
		await screen.getByRole('button', { name: 'Save column' }).click();
		expect(onsubmit).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'edit-column', nextDocstring: 'Number of events' })
		);

		await screen.rerender({ isRunning: true });
		await expect.element(screen.getByRole('button', { name: 'Saving column' })).toBeDisabled();
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
