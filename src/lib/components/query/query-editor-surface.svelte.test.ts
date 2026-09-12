import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { QueryTab } from '$lib/cluster/cluster-session.svelte';

import QueryEditorSurface from './query-editor-surface.svelte';

const originalTab: QueryTab = {
	id: 'original',
	database: 'Samples',
	query: 'Events | count',
	isRunning: false
};
const modifiedTab: QueryTab = {
	id: 'modified',
	database: 'Samples',
	query: 'Events | take 10',
	isRunning: false
};
const databaseSchema = {
	Samples: {
		name: 'Samples',
		tables: [{ name: 'Events', columns: [{ name: 'Message', type: 'string' }] }]
	}
};

function createProps() {
	return {
		activeTabId: modifiedTab.id,
		queryText: modifiedTab.query,
		selectedDatabase: 'Samples',
		databaseSchema,
		clusterUrl: 'mock://kite',
		comparisonOriginalTabId: undefined,
		originalTab: undefined,
		modifiedTab: undefined,
		compareCandidates: [originalTab],
		titleFor: (tab: QueryTab) => `Query ${tab.id}`,
		onexecute: vi.fn(),
		onexecutecomparison: vi.fn(),
		onquerychange: vi.fn(),
		onmodifiedchange: vi.fn(),
		onoriginalchange: vi.fn(),
		oncomparisonoriginalchange: vi.fn(),
		oncomparisonsidechange: vi.fn(),
		onlanguagestatuschange: vi.fn()
	};
}

describe('QueryEditorSurface', () => {
	it('renders a normal editor and exposes its query text', async () => {
		const screen = await render(QueryEditorSurface, createProps());
		await expect.element(screen.getByText('Events | take 10')).toBeVisible();
		await expect.element(screen.getByLabelText('Query comparison')).not.toBeInTheDocument();
	});

	it('renders comparison metadata and changes the reference query', async () => {
		const props = createProps();
		const screen = await render(QueryEditorSurface, {
			...props,
			comparisonOriginalTabId: originalTab.id,
			originalTab,
			modifiedTab
		});

		const comparison = screen.getByLabelText('Query comparison');
		await expect.element(comparison).toBeVisible();
		await expect.element(comparison.getByText('Query original')).toBeVisible();
		await expect.element(comparison.getByText('Query modified')).toBeVisible();
		await expect.element(comparison.getByText('DB: Samples')).toBeVisible();

		await comparison.getByLabelText('Reference query').click();
		await expect.element(screen.getByRole('option', { name: 'Query original' })).toBeVisible();
	});
});
