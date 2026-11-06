import type { ConfirmAction } from '$lib/app/confirmation-prompt.svelte';
import type { ClusterSession, QueryTab } from '$lib/cluster/cluster-session.svelte';
import type { SavedQueryStore } from '$lib/query/saved-query-store.svelte';

export type ComparisonSide = 'left' | 'right';

export type QueryTabComparisonState = {
	comparisonOriginalTabId?: string;
	comparisonModifiedTabId?: string;
	focusedComparisonSide: ComparisonSide;
};

type QueryTabControllerOptions = {
	session: ClusterSession;
	savedQueries: SavedQueryStore;
	onTabClosing: (tabId: string) => void;
	/** Asks before closing a running or unsaved tab. */
	confirm: ConfirmAction;
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
	const state = $state<QueryTabComparisonState>({ focusedComparisonSide: 'right' });

	/** Makes `tab` active and selects its database in the Explorer. */
	function load(tab: QueryTab) {
		session.activeQueryTabId = tab.id;
		if (tab.database && session.databaseSchema?.[tab.database]) {
			session.selectedDatabase = tab.database;
		}
		session.selectedTable = undefined;
		session.selectedFunction = undefined;
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
		database = session.selectedDatabase,
		query = '',
		savedQuery?: Pick<QueryTab, 'savedQueryId' | 'savedQueryName'>
	) {
		const { original, modified } = comparedTabs();
		const keepActive = Boolean(original && modified);
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

	async function close(tab: QueryTab) {
		const title = titleFor(tab);
		if (
			tab.isRunning &&
			!(await options.confirm({
				title: 'Cancel running query?',
				description: `Cancel the running query in “${title}” and close its tab?`,
				actionLabel: 'Cancel query and close'
			}))
		) {
			return;
		}
		if (
			isDirty(tab) &&
			!(await options.confirm({
				title: `Close “${title}”?`,
				description: 'Its query text will be lost.',
				actionLabel: 'Close tab'
			}))
		)
			return;
		// The tab may have been closed elsewhere while a confirmation was open.
		if (!session.getQueryTab(tab.id)) return;
		options.onTabClosing(tab.id);
		session.closeQueryTab(tab.id);
		if (state.comparisonOriginalTabId === tab.id || state.comparisonModifiedTabId === tab.id)
			stopComparison();
		const next = activeTab();
		if (next) load(next);
	}

	function updateComparisonQuery(side: ComparisonSide, value: string) {
		const { original, modified } = comparedTabs();
		const tab = side === 'left' ? original : modified;
		if (!tab) return;
		session.updateQueryTab(tab.id, { query: value });
	}

	return {
		state,
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
		updateComparisonQuery
	};
}
