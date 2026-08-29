import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClusterSession } from '$lib/cluster/cluster-session.svelte';
import type { SavedQuery } from '$lib/query/saved-query-store.svelte';
import { createQueryTabController } from './query-tab-controller.svelte';

function createController(savedQueries: SavedQuery[] = []) {
	const session = createClusterSession('cluster');
	const setSelectedDatabase = vi.fn((database: string) => (session.selectedDatabase = database));
	const clearSchemaSelection = vi.fn();
	const onTabLoaded = vi.fn();
	const onTabClosing = vi.fn();
	session.databaseSchema = {
		Alpha: { name: 'Alpha', tables: [], functions: [] },
		Beta: { name: 'Beta', tables: [], functions: [] }
	};
	const controller = createQueryTabController({
		session,
		savedQueries: { queries: savedQueries } as never,
		getSelectedDatabase: () => session.selectedDatabase,
		setSelectedDatabase,
		clearSchemaSelection,
		onTabLoaded,
		onTabClosing
	});
	return {
		controller,
		session,
		setSelectedDatabase,
		clearSchemaSelection,
		onTabLoaded,
		onTabClosing
	};
}

beforeEach(() => {
	vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe('query tab controller', () => {
	it('only compares tabs from the same database', () => {
		const { controller, session } = createController();
		const first = session.queryTabs[0];
		session.updateQueryTab(first.id, { database: 'Alpha', query: 'first' });
		const otherDatabase = session.createQueryTab('Beta', 'second');
		const active = session.createQueryTab(' alpha ', 'third');

		controller.startComparison();

		expect(controller.comparison.modified?.id).toBe(active.id);
		expect(controller.comparison.original?.id).toBe(first.id);
		expect(controller.comparison.candidates.map((tab) => tab.id)).toEqual([first.id]);

		controller.stopComparison();
		controller.compareWith(otherDatabase);
		expect(controller.comparison.original).toBeUndefined();
	});

	it('detects unsaved and changed saved tabs without flagging blank tabs', () => {
		const savedQuery: SavedQuery = {
			id: 'saved',
			clusterId: 'cluster',
			database: 'Alpha',
			name: 'Saved query',
			query: 'StormEvents | take 10',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		};
		const { controller, session } = createController([savedQuery]);
		const blank = session.queryTabs[0];
		const savedTab = session.createQueryTab('Alpha', savedQuery.query, {
			savedQueryId: savedQuery.id,
			savedQueryName: savedQuery.name
		});

		expect(controller.isDirty(blank)).toBe(false);
		expect(controller.isDirty(session.getQueryTab(savedTab.id)!)).toBe(false);
		session.updateQueryTab(savedTab.id, { query: `${savedQuery.query}\n| count` });
		expect(controller.isDirty(session.getQueryTab(savedTab.id)!)).toBe(true);
		session.updateQueryTab(blank.id, { query: 'print Value = 1' });
		expect(controller.isDirty(session.getQueryTab(blank.id)!)).toBe(true);
	});

	it('does not close a dirty tab when confirmation is declined', () => {
		const { controller, session, onTabClosing } = createController();
		const tab = session.queryTabs[0];
		session.updateQueryTab(tab.id, { database: 'Alpha', query: 'print Value = 1' });
		vi.mocked(window.confirm).mockReturnValue(false);

		controller.close(tab);

		expect(session.queryTabs).toContain(tab);
		expect(onTabClosing).not.toHaveBeenCalled();
	});

	it('ends comparison when either compared tab closes', () => {
		const { controller, session, onTabClosing } = createController();
		const first = session.queryTabs[0];
		session.updateQueryTab(first.id, { database: 'Alpha' });
		const second = session.createQueryTab('Alpha');
		controller.startComparison();

		controller.close(first);

		expect(onTabClosing).toHaveBeenCalledWith(first.id);
		expect(controller.comparison.original).toBeUndefined();
		expect(controller.comparison.modified?.id).toBe(second.id);
	});

	it('keeps the compared tab active when creating another tab', () => {
		const { controller, session, onTabLoaded } = createController();
		const first = session.queryTabs[0];
		session.updateQueryTab(first.id, { database: 'Alpha' });
		const second = session.createQueryTab('Alpha');
		controller.startComparison();
		onTabLoaded.mockClear();

		const created = controller.create('Alpha', 'print Value = 3');

		expect(session.activeQueryTabId).toBe(second.id);
		expect(session.queryTabs.map((tab) => tab.id)).toContain(created.id);
		expect(onTabLoaded).not.toHaveBeenCalled();
	});
});
