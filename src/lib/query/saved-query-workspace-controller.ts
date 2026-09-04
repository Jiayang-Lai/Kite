import type { ClusterSession, QueryTab } from '$lib/cluster/cluster-session.svelte';
import type { SavedQueryStore } from '$lib/query/saved-query-store.svelte';

type WorkspaceQuery = {
	id?: string;
	database: string;
	query: string;
};

export type SavedQueryWorkspaceState = {
	dialogOpen: boolean;
	name: string;
	nameError: string;
	pendingTabId?: string;
};

type SavedQueryWorkspaceControllerOptions = {
	state: SavedQueryWorkspaceState;
	session: ClusterSession;
	savedQueries: SavedQueryStore;
	getActiveClusterId: () => string;
	getActiveTabId: () => string;
	getTabs: () => QueryTab[];
	loadTab: (tab: QueryTab) => void;
	createTab: (
		database: string,
		query: string,
		savedQuery?: Pick<QueryTab, 'savedQueryId' | 'savedQueryName'>
	) => void;
	setExecutionQuery: (query: string) => void;
	navigateToEditor: () => void;
};

/** Owns saved-query lookup, tab reuse, and save-dialog workflows. */
export function createSavedQueryWorkspaceController(options: SavedQueryWorkspaceControllerOptions) {
	function findSavedQuery(query: WorkspaceQuery) {
		return query.id
			? options.savedQueries.queries.find(
					(candidate) =>
						candidate.id === query.id && candidate.clusterId === options.getActiveClusterId()
				)
			: undefined;
	}

	function findOpenTab(savedQueryId?: string) {
		return savedQueryId
			? options.getTabs().find((tab) => tab.savedQueryId === savedQueryId)
			: undefined;
	}

	function load(query: WorkspaceQuery) {
		const savedQuery = findSavedQuery(query);
		const existingTab = findOpenTab(savedQuery?.id);
		if (existingTab) {
			options.loadTab(existingTab);
			return;
		}
		options.createTab(
			query.database,
			query.query,
			savedQuery ? { savedQueryId: savedQuery.id, savedQueryName: savedQuery.name } : undefined
		);
	}

	function openFromNonEditorView(query: WorkspaceQuery) {
		options.session.selectedDatabase = query.database;
		options.session.selectedTable = undefined;
		options.session.selectedFunction = undefined;
		const savedQuery = findSavedQuery(query);
		const existingTab = findOpenTab(savedQuery?.id);
		if (existingTab) {
			options.session.activeQueryTabId = existingTab.id;
			options.session.pendingQuery = undefined;
		} else {
			options.session.pendingQuery = query.query;
			options.session.createQueryTab(
				query.database,
				query.query,
				savedQuery ? { savedQueryId: savedQuery.id, savedQueryName: savedQuery.name } : undefined
			);
		}
		options.navigateToEditor();
	}

	function openSaveDialog(tab: QueryTab) {
		if (!tab.query.trim() || !tab.database) return;
		options.state.pendingTabId = tab.id;
		options.state.name = '';
		options.state.nameError = '';
		options.state.dialogOpen = true;
	}

	function save(tab: QueryTab | undefined) {
		if (!tab) return;
		const query = tab.query.trim();
		if (!query || !tab.database) return;
		const savedQuery = tab.savedQueryId
			? options.savedQueries.queries.find((candidate) => candidate.id === tab.savedQueryId)
			: undefined;
		if (!savedQuery) {
			openSaveDialog(tab);
			return;
		}

		const updatedQuery = options.savedQueries.update(savedQuery.id, {
			clusterId: options.getActiveClusterId(),
			database: tab.database,
			name: savedQuery.name,
			query
		});
		if (!updatedQuery) return;
		options.session.updateQueryTab(tab.id, {
			savedQueryName: updatedQuery.name,
			query: updatedQuery.query,
			database: updatedQuery.database
		});
		if (tab.id === options.getActiveTabId()) options.setExecutionQuery(updatedQuery.query);
	}

	function saveNew(tab: QueryTab | undefined) {
		if (!tab) return;
		const query = tab.query.trim();
		if (!query || !tab.database) return;
		const name = options.state.name.trim();
		if (!name) {
			options.state.nameError = 'Enter a name for this query.';
			return;
		}

		const savedQuery = options.savedQueries.save({
			clusterId: options.getActiveClusterId(),
			database: tab.database,
			name,
			query
		});
		options.session.updateQueryTab(tab.id, {
			savedQueryId: savedQuery.id,
			savedQueryName: savedQuery.name,
			query: savedQuery.query
		});
		if (tab.id === options.getActiveTabId()) options.setExecutionQuery(savedQuery.query);
		options.state.dialogOpen = false;
		options.state.pendingTabId = undefined;
	}

	return { load, openFromNonEditorView, openSaveDialog, save, saveNew };
}
