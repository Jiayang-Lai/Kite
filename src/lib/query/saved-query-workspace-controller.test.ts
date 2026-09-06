import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClusterSession } from '$lib/cluster/cluster-session.svelte';
import type { SavedQuery, SavedQueryStore } from '$lib/query/saved-query-store.svelte';
import {
	createSavedQueryWorkspaceController,
	type SavedQueryWorkspaceState
} from './saved-query-workspace-controller';

const savedQuery: SavedQuery = {
	id: 'saved-1',
	clusterId: 'cluster',
	database: 'Analytics',
	name: 'Errors',
	query: 'Events | where Level == "Error"',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z'
};

function setup(queries: SavedQuery[] = [savedQuery]) {
	const session = createClusterSession('cluster');
	const state: SavedQueryWorkspaceState = {
		dialogOpen: false,
		name: '',
		nameError: ''
	};
	const loadTab = vi.fn();
	const createTab = vi.fn((database, query, saved) => {
		session.createQueryTab(database, query, saved);
	});
	const setExecutionQuery = vi.fn();
	const navigateToEditor = vi.fn();
	const store = {
		queries,
		update: vi.fn((id, draft) =>
			id === savedQuery.id ? { ...savedQuery, ...draft, id } : undefined
		),
		save: vi.fn((draft) => ({ ...savedQuery, ...draft, id: 'saved-new' }))
	} as unknown as SavedQueryStore;
	const controller = createSavedQueryWorkspaceController({
		state,
		session,
		savedQueries: store,
		getActiveClusterId: () => session.activeClusterId,
		getActiveTabId: () => session.activeQueryTabId,
		getTabs: () => session.queryTabs,
		loadTab,
		createTab,
		setExecutionQuery,
		navigateToEditor
	});
	return {
		controller,
		state,
		session,
		store,
		loadTab,
		createTab,
		setExecutionQuery,
		navigateToEditor
	};
}

beforeEach(() => vi.clearAllMocks());

describe('saved query workspace controller', () => {
	it('reuses an open tab for a saved query', () => {
		const context = setup();
		const tab = context.session.createQueryTab(savedQuery.database, savedQuery.query, {
			savedQueryId: savedQuery.id,
			savedQueryName: savedQuery.name
		});

		context.controller.load(savedQuery);

		expect(context.loadTab).toHaveBeenCalledWith(tab);
		expect(context.createTab).not.toHaveBeenCalled();
	});

	it('opens a saved query in a new editor tab when needed', () => {
		const context = setup();

		context.controller.load(savedQuery);

		expect(context.createTab).toHaveBeenCalledWith('Analytics', savedQuery.query, {
			savedQueryId: savedQuery.id,
			savedQueryName: savedQuery.name
		});
	});

	it('prepares non-editor navigation and avoids duplicating an open tab', () => {
		const context = setup();
		const tab = context.session.createQueryTab(savedQuery.database, savedQuery.query, {
			savedQueryId: savedQuery.id
		});
		context.session.pendingQuery = 'stale';

		context.controller.openFromNonEditorView(savedQuery);

		expect(context.session.activeQueryTabId).toBe(tab.id);
		expect(context.session.pendingQuery).toBeUndefined();
		expect(context.session.selectedDatabase).toBe('Analytics');
		expect(context.navigateToEditor).toHaveBeenCalledOnce();
	});

	it('opens the dialog for a new save and validates its name', () => {
		const context = setup([]);
		const tab = context.session.queryTabs[0];
		context.session.updateQueryTab(tab.id, { database: 'Analytics', query: '  Events | count  ' });

		context.controller.save(tab);
		expect(context.state).toMatchObject({ dialogOpen: true, pendingTabId: tab.id });

		context.controller.saveNew(tab);
		expect(context.state.nameError).toBe('Enter a name for this query.');
		expect(context.store.save).not.toHaveBeenCalled();
	});

	it('creates and attaches a named saved query to the active tab', () => {
		const context = setup([]);
		const tab = context.session.queryTabs[0];
		context.session.updateQueryTab(tab.id, { database: 'Analytics', query: ' Events | count ' });
		context.state.name = ' Event count ';
		context.state.dialogOpen = true;

		context.controller.saveNew(tab);

		expect(context.store.save).toHaveBeenCalledWith({
			clusterId: 'cluster',
			database: 'Analytics',
			name: 'Event count',
			query: 'Events | count'
		});
		expect(context.session.getQueryTab(tab.id)).toMatchObject({
			savedQueryId: 'saved-new',
			savedQueryName: 'Event count',
			query: 'Events | count'
		});
		expect(context.setExecutionQuery).toHaveBeenCalledWith('Events | count');
		expect(context.state.dialogOpen).toBe(false);
	});

	it('keeps the save dialog open when durable storage rejects the write', () => {
		const context = setup([]);
		const tab = context.session.queryTabs[0];
		context.session.updateQueryTab(tab.id, { database: 'Analytics', query: 'Events | count' });
		context.state.name = 'Event count';
		context.state.dialogOpen = true;
		Object.defineProperty(context.store, 'storageError', {
			value: 'Saved queries could not be stored locally.'
		});
		vi.mocked(context.store.save).mockReturnValueOnce(undefined);

		context.controller.saveNew(tab);

		expect(context.state.dialogOpen).toBe(true);
		expect(context.state.nameError).toBe('Saved queries could not be stored locally.');
		expect(context.session.getQueryTab(tab.id)?.savedQueryId).toBeUndefined();
	});

	it('updates an existing saved query without opening the dialog', () => {
		const context = setup();
		const tab = context.session.createQueryTab('Analytics', `${savedQuery.query}\n| count`, {
			savedQueryId: savedQuery.id,
			savedQueryName: savedQuery.name
		});

		context.controller.save(tab);

		expect(context.store.update).toHaveBeenCalledWith(savedQuery.id, {
			clusterId: 'cluster',
			database: 'Analytics',
			name: 'Errors',
			query: `${savedQuery.query}\n| count`
		});
		expect(context.state.dialogOpen).toBe(false);
	});
});
