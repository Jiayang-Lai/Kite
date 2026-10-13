import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { ExplorerExpansionState } from '$lib/cluster/cluster-session.svelte';
import type { KustoDatabase } from '$lib/types/kusto-schema';
import DatabaseSchema from './database-schema.svelte';

const database: KustoDatabase = {
	name: 'Analytics',
	tables: [
		{
			name: 'Events',
			docstring: 'Raw sensor events',
			columns: [
				{ name: 'Timestamp', type: 'datetime', docstring: 'When the sensor reported' },
				{ name: 'Message', type: 'string' }
			]
		}
	],
	functions: [
		{
			name: 'RecentEvents',
			docstring: 'Events from the last window',
			body: '{ Events | where Timestamp > ago(window) }',
			inputParameters: [
				{
					name: 'window',
					cslType: 'timespan',
					docstring: 'How far back to look',
					cslDefaultValue: '1h'
				}
			]
		},
		{ name: 'AllEvents', body: '{ Events }', inputParameters: [] }
	]
};

function expansionState(): ExplorerExpansionState {
	return {
		databases: {},
		groups: {},
		schemaTables: {},
		sections: { 'saved-queries': false, 'recent-queries': false }
	};
}

describe('DatabaseSchema', () => {
	it('shows a stored function with its signature, parameters, and body', async () => {
		const screen = await render(DatabaseSchema, {
			database,
			selectedFunction: 'RecentEvents',
			expansionState: expansionState(),
			onexpansionchange: vi.fn()
		});

		await expect.element(screen.getByText('Stored function')).toBeVisible();
		await expect.element(screen.getByText('Events from the last window')).toBeVisible();
		await expect.element(screen.getByText('RecentEvents(window: timespan = 1h)')).toBeVisible();
		await expect.element(screen.getByText('How far back to look')).toBeVisible();
		await expect.element(screen.getByText('Default:')).toBeVisible();
		await expect.element(screen.getByText(/ago\(window\)/)).toBeVisible();
		await expect
			.element(screen.getByPlaceholder('Filter tables or columns'))
			.not.toBeInTheDocument();
	});

	it('explains when a stored function takes no parameters', async () => {
		const screen = await render(DatabaseSchema, {
			database,
			selectedFunction: 'AllEvents',
			expansionState: expansionState(),
			onexpansionchange: vi.fn()
		});

		await expect.element(screen.getByText('This function has no parameters.')).toBeVisible();
		await expect.element(screen.getByText('AllEvents()')).toBeVisible();
	});

	it('highlights filter matches in table and column docstrings', async () => {
		const screen = await render(DatabaseSchema, {
			database,
			expansionState: expansionState(),
			onexpansionchange: vi.fn()
		});

		await screen.getByPlaceholder('Filter tables or columns').fill('sensor');
		await expect.element(screen.getByText('Matches expanded')).toBeVisible();
		await vi.waitFor(() => {
			const marks = [...screen.container.querySelectorAll('mark')].map((mark) => mark.textContent);
			expect(marks).toEqual(['sensor', 'sensor']);
		});
		await expect.element(screen.getByText('When the sensor reported')).toBeVisible();

		await screen.getByPlaceholder('Filter tables or columns').fill('nothing-matches');
		await expect
			.element(screen.getByText('No tables or columns match “nothing-matches”.'))
			.toBeVisible();
	});
});
