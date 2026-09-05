import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { TableSchemaSnapshot } from '$lib/kusto/table-management';
import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import ColumnOrderDialog from './column-order-dialog.svelte';
import TableEditorDialog from './table-editor-dialog.svelte';

const table = {
	name: 'Events',
	docstring: 'Existing events',
	columns: [
		{ name: 'Message', type: 'string' },
		{ name: 'Count', type: 'long' }
	]
};
const snapshot: TableSchemaSnapshot = {
	databaseName: 'Samples',
	tableName: 'Events',
	columns: table.columns,
	docstring: table.docstring,
	tableId: 'table-1',
	totalRowCount: 12
};

describe('table editing dialogs', () => {
	beforeEach(() => localStorage.clear());

	it('reorders, reviews, and submits the complete column order', async () => {
		const onsubmit = vi.fn();
		const screen = await render(
			ColumnOrderDialog,
			{
				open: true,
				table,
				databaseName: 'Samples',
				clusterName: 'Production',
				preflightReady: true,
				snapshot,
				onsubmit
			},
			{ wrapper: AppContextWrapper }
		);
		await expect
			.element(screen.getByRole('heading', { name: 'Reorder Events columns' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Move Message up' })).toBeDisabled();
		await screen.getByRole('button', { name: 'Move Message down' }).click();
		await screen.getByRole('button', { name: 'Review order' }).click();
		await expect
			.element(screen.getByRole('heading', { name: 'Review column order' }))
			.toBeVisible();
		await expect.element(screen.getByText('Coordinate order-dependent ingestion')).toBeVisible();
		await screen.getByLabelText(/Type REORDER Events/).fill('REORDER Events');
		await screen.getByRole('button', { name: 'Apply order' }).click();
		expect(onsubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'reorder-table-columns',
				columns: [
					{ name: 'Count', type: 'long' },
					{ name: 'Message', type: 'string' }
				]
			})
		);
	});

	it('renders unavailable and preparing order states', async () => {
		const oncancel = vi.fn();
		const screen = await render(
			ColumnOrderDialog,
			{
				open: true,
				table,
				databaseName: 'Samples',
				clusterName: 'Production',
				isPreparing: true,
				executionError: 'Metadata failed',
				oncancel
			},
			{ wrapper: AppContextWrapper }
		);
		await expect.element(screen.getByText(/order editor will load/)).toBeVisible();
		await expect.element(screen.getByRole('alert')).toHaveTextContent('Metadata failed');
		await expect
			.element(screen.getByRole('button', { name: 'Checking current schema' }))
			.toBeDisabled();
		await screen.getByRole('button', { name: 'Cancel' }).click();
		expect(oncancel).toHaveBeenCalledOnce();
	});

	it('adds columns and submits a reviewed table update', async () => {
		const onsubmit = vi.fn();
		const screen = await render(
			TableEditorDialog,
			{
				open: true,
				table,
				databaseName: 'Samples',
				clusterName: 'Production',
				preflightReady: true,
				snapshot,
				onsubmit
			},
			{ wrapper: AppContextWrapper }
		);
		await expect.element(screen.getByLabelText('Description')).toHaveValue('Existing events');
		await screen.getByLabelText('Description').fill('Updated events');
		await screen.getByRole('button', { name: 'Add column' }).click();
		await screen.getByLabelText('Column name').fill('CreatedAt');
		await screen.getByLabelText('Type').click();
		await screen.getByRole('option', { name: 'datetime' }).click();
		await screen.getByRole('button', { name: 'Review changes' }).click();
		await expect
			.element(screen.getByRole('heading', { name: 'Review table update' }))
			.toBeVisible();
		await screen.getByLabelText('Type RUN to enable the update').fill('RUN');
		await screen.getByRole('button', { name: 'Update table' }).click();
		expect(onsubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'update-table',
				nextDocstring: 'Updated events',
				addedColumns: [{ name: 'CreatedAt', type: 'datetime' }]
			})
		);
	});

	it('renders empty, preparing, and running table states', async () => {
		const oncancel = vi.fn();
		const emptyTable = { name: 'Empty', columns: [] };
		const screen = await render(
			TableEditorDialog,
			{
				open: true,
				table: emptyTable,
				databaseName: 'Samples',
				clusterName: 'Production',
				isPreparing: true,
				executionError: 'Update failed',
				oncancel
			},
			{ wrapper: AppContextWrapper }
		);
		await expect.element(screen.getByText('This table has no columns.')).toBeVisible();
		await expect.element(screen.getByRole('alert')).toHaveTextContent('Update failed');
		await screen.rerender({
			open: true,
			table: emptyTable,
			databaseName: 'Samples',
			clusterName: 'Production',
			isPreparing: false,
			isRunning: true,
			oncancel
		});
		await expect.element(screen.getByRole('button', { name: 'Updating table' })).toBeDisabled();
		await screen.getByRole('button', { name: 'Stop waiting' }).click();
		expect(oncancel).toHaveBeenCalledOnce();
	});
});
