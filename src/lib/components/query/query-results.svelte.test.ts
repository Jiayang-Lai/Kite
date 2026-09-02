import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import QueryResults from './query-results.svelte';

const emptyResult = {
	columns: [],
	rows: [],
	totalRowCount: 0,
	renderedRowCount: 0,
	warnings: [],
	elapsedMs: 18.6,
	clientRequestId: 'Kite.Query;test'
};

describe('QueryResults', () => {
	it('shows idle, running, and completed-without-table states', async () => {
		const screen = await render(QueryResults);
		await expect.element(screen.getByText('Run a query to see its results.')).toBeVisible();

		await screen.rerender({ isRunning: true, operationLabel: 'Command' });
		await expect.element(screen.getByText('Running command…')).toBeVisible();

		await screen.rerender({ result: emptyResult, operationLabel: 'Command' });
		await expect
			.element(screen.getByText('Query completed successfully without a tabular result.'))
			.toBeVisible();
	});

	it('renders actionable error diagnostics and expands for a new error', async () => {
		const screen = await render(QueryResults, {
			collapsed: true,
			error: 'Syntax error on line 2',
			errorRequestId: 'request-123',
			errorRaw: { code: 'SYN0002' },
			operationLabel: 'Command'
		});

		await expect.element(screen.getByText('Command failed')).toBeVisible();
		await expect.element(screen.getByText('Syntax error on line 2')).toBeVisible();
		await expect.element(screen.getByText('request-123')).toBeVisible();
		await expect.element(screen.getByText('Raw error JSON')).toBeVisible();
	});

	it('collapses and expands through its accessible toggle', async () => {
		const oncollapsedchange = vi.fn();
		const screen = await render(QueryResults, { result: emptyResult, oncollapsedchange });

		await screen.getByRole('button', { name: 'Collapse results drawer' }).click();
		expect(oncollapsedchange).toHaveBeenCalledWith(true);
		await expect
			.element(screen.getByRole('button', { name: 'Expand results drawer' }))
			.toBeVisible();

		await screen.getByRole('button', { name: 'Expand results drawer' }).click();
		expect(oncollapsedchange).toHaveBeenLastCalledWith(false);
	});

	it('shows warnings and execution details in the messages tab', async () => {
		const result = {
			...emptyResult,
			warnings: ['Result was truncated'],
			statistics: { cpu: 12 } as never,
			totalRowCount: 42,
			renderedRowCount: 40
		};
		const screen = await render(QueryResults, { result });

		await screen.getByRole('tab', { name: /Messages/ }).click();
		await expect.element(screen.getByText('Result was truncated')).toBeVisible();
		await expect.element(screen.getByRole('heading', { name: 'Query details' })).toBeVisible();
		await expect.element(screen.getByText('Raw Azure statistics')).toBeVisible();
	});

	it('returns to the results tab when a new error arrives', async () => {
		const screen = await render(QueryResults, {
			result: { ...emptyResult, warnings: ['Warning'] }
		});
		await screen.getByRole('tab', { name: /Messages/ }).click();
		await expect.element(screen.getByText('Warning')).toBeVisible();

		await screen.rerender({ error: 'Request failed', result: emptyResult });
		await expect.element(screen.getByText('Query failed')).toBeVisible();
	});
});
