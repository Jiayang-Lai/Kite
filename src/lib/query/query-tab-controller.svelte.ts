import type { ClusterSession, QueryTab } from '$lib/cluster/cluster-session.svelte';
import type { SavedQueryStore } from '$lib/query/saved-query-store.svelte';

export type ComparisonSide = 'left' | 'right';

export type QueryTabComparisonState = {
	comparisonOriginalTabId?: string;
	comparisonModifiedTabId?: string;
	focusedComparisonSide: ComparisonSide;
};

type QueryTabControllerOptions = {
	state?: QueryTabComparisonState;
	session: ClusterSession;
	savedQueries: SavedQueryStore;
	getSelectedDatabase: () => string;
	setSelectedDatabase: (database: string) => void;
	clearSchemaSelection: () => void;
	onTabLoaded: (tab: QueryTab) => void;
	onTabClosing: (tabId: string) => void;
};

function titleFor(tab: QueryTab) {
	if (tab.savedQueryName) return tab.savedQueryName;
	const firstLine = tab.query
		.split('\n')
		.find((line) => line.trim())
		?.trim();
	return firstLine?.replaceAll(/\s+/g, ' ').slice(0, 32) || 'Untitled query';
}

/** Owns query-tab selection, unsaved state, and two-tab comparison rules. */
export function createQueryTabController(options: QueryTabControllerOptions) {
	const { session } = options;
	let state = $state<QueryTabComparisonState>({ focusedComparisonSide: 'right' });
	if (options.state) state = options.state;

	function load(tab: QueryTab) {
		session.activeQueryTabId = tab.id;
		if (tab.database && session.databaseSchema?.[tab.database]) {
			options.setSelectedDatabase(tab.database);
		}
		options.clearSchemaSelection();
		options.onTabLoaded(tab);
	}

	function activeTab() {
		return session.getQueryTab(session.activeQueryTabId);
	}

	function comparedTabs() {
		const modified = state.comparisonModifiedTabId
			? session.queryTabs.find((tab) => tab.id === state.comparisonModifiedTabId)
			: activeTab();
		const candidates = modified
			? session.queryTabs.filter(
					(tab) =>
						tab.id !== modified.id &&
						tab.database.trim().toLowerCase() === modified.database.trim().toLowerCase()
				)
			: [];
		const original = state.comparisonOriginalTabId
			? candidates.find((tab) => tab.id === state.comparisonOriginalTabId)
			: undefined;
		return { modified, original, candidates };
	}

	function stopComparison() {
		state.comparisonOriginalTabId = undefined;
		state.comparisonModifiedTabId = undefined;
		state.focusedComparisonSide = 'right';
	}

	function startComparison() {
		const tab = activeTab();
		if (!tab) return;
		state.comparisonModifiedTabId = tab.id;
		const candidate = session.queryTabs.find(
			(other) =>
				other.id !== tab.id &&
				other.database.trim().toLowerCase() === tab.database.trim().toLowerCase()
		);
		if (!candidate) {
			state.comparisonModifiedTabId = undefined;
			return;
		}
		state.comparisonOriginalTabId = candidate.id;
		state.focusedComparisonSide = 'right';
	}

	function compareWith(tab: QueryTab) {
		const active = activeTab();
		if (!active || tab.id === active.id) return;
		if (tab.database.trim().toLowerCase() !== active.database.trim().toLowerCase()) return;
		state.comparisonModifiedTabId = active.id;
		state.comparisonOriginalTabId = tab.id;
		state.focusedComparisonSide = 'right';
	}

	function create(
		database = options.getSelectedDatabase(),
		query = '',
		savedQuery?: Pick<QueryTab, 'savedQueryId' | 'savedQueryName'>
	) {
		const keepActive = Boolean(comparedTabs().original && comparedTabs().modified);
		const activeId = session.activeQueryTabId;
		const tab = session.createQueryTab(database, query, savedQuery);
		if (keepActive) {
			session.activeQueryTabId = activeId;
			return tab;
		}
		load(tab);
		return tab;
	}

	function select(tab: QueryTab) {
		const { original, modified } = comparedTabs();
		if (original && modified && tab.id !== original.id && tab.id !== modified.id) return;
		load(tab);
	}

	function isDirty(tab: QueryTab) {
		if (!tab.query.trim()) return false;
		if (!tab.savedQueryId) return true;
		const saved = options.savedQueries.queries.find((query) => query.id === tab.savedQueryId);
		return !saved || tab.database !== saved.database || tab.query.trim() !== saved.query;
	}

	function close(tab: QueryTab) {
		if (
			tab.isRunning &&
			!window.confirm(`Cancel the running query in “${titleFor(tab)}” and close its tab?`)
		) {
			return;
		}
		if (isDirty(tab) && !window.confirm(`Close “${titleFor(tab)}”? Its query text will be lost.`))
			return;
		options.onTabClosing(tab.id);
		session.closeQueryTab(tab.id);
		if (state.comparisonOriginalTabId === tab.id || state.comparisonModifiedTabId === tab.id)
			stopComparison();
		const next = activeTab();
		if (next) load(next);
	}

	function updateActiveQuery(value: string) {
		const tab = activeTab();
		if (tab) session.updateQueryTab(tab.id, { query: value });
	}

	function updateComparisonQuery(side: ComparisonSide, value: string) {
		const { original, modified } = comparedTabs();
		const tab = side === 'left' ? original : modified;
		if (!tab) return;
		session.updateQueryTab(tab.id, { query: value });
	}

	return {
		get tabs() {
			return session.queryTabs;
		},
		get activeTabId() {
			return session.activeQueryTabId;
		},
		get activeTab() {
			return activeTab();
		},
		get state() {
			return state;
		},
		get comparison() {
			return comparedTabs();
		},
		titleFor,
		load,
		create,
		select,
		close,
		isDirty,
		startComparison,
		stopComparison,
		compareWith,
		updateActiveQuery,
		updateComparisonQuery
	};
}
