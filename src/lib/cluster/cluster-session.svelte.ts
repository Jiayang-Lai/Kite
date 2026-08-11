import { getContext, setContext } from 'svelte';

import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
import type { QueryResult } from '$lib/types/query-result';

const CLUSTER_SESSION = Symbol('cluster-session');

export type ExplorerExpansionState = {
	databases: Record<string, boolean>;
	groups: Record<string, boolean>;
	schemaTables: Record<string, Record<string, boolean>>;
	sections: Record<'saved-queries' | 'recent-queries', boolean>;
};

export type ExplorerExpansionChange =
	| { type: 'database'; database: string; open: boolean }
	| { type: 'group'; database: string; group: 'tables' | 'functions'; open: boolean }
	| { type: 'schema-table'; database: string; table: string; open: boolean }
	| { type: 'section'; section: 'saved-queries' | 'recent-queries'; open: boolean };

export type QueryTab = {
	id: string;
	database: string;
	query: string;
	savedQueryId?: string;
	savedQueryName?: string;
	result?: QueryResult;
	error?: string;
	errorRequestId?: string;
	errorRaw?: unknown;
	isRunning: boolean;
};

export type ClusterSession = {
	activeClusterId: string;
	databaseSchema?: KustoDatabaseSchema;
	selectedDatabase: string;
	selectedTable?: string;
	selectedFunction?: string;
	pendingQuery?: string;
	readonly queryTabs: QueryTab[];
	activeQueryTabId: string;
	getQueryTab: (id: string) => QueryTab | undefined;
	createQueryTab: (
		database: string,
		query?: string,
		savedQuery?: Pick<QueryTab, 'savedQueryId' | 'savedQueryName'>
	) => QueryTab;
	updateQueryTab: (id: string, update: Partial<Omit<QueryTab, 'id'>>) => void;
	closeQueryTab: (id: string) => void;
	resetQueryTabs: (database?: string) => void;
	getExplorerExpansion: (clusterId: string) => ExplorerExpansionState;
	setExplorerExpansion: (clusterId: string, change: ExplorerExpansionChange) => void;
};

/** Creates the app-wide, confirmed cluster selection shared by feature pages. */
export function createClusterSession(initialClusterId: string): ClusterSession {
	let nextQueryTabId = 0;
	const createQueryTabId = () => `query-tab-${++nextQueryTabId}`;
	let activeClusterId = $state(initialClusterId);
	let databaseSchema = $state.raw<KustoDatabaseSchema>();
	let selectedDatabase = $state('');
	let selectedTable = $state<string>();
	let selectedFunction = $state<string>();
	let pendingQuery = $state<string>();
	const initialQueryTab: QueryTab = {
		id: createQueryTabId(),
		database: '',
		query: '',
		isRunning: false
	};
	let queryTabs = $state<QueryTab[]>([initialQueryTab]);
	let activeQueryTabId = $state(initialQueryTab.id);
	let explorerExpansionByCluster = $state<Record<string, ExplorerExpansionState>>({
		[initialClusterId]: {
			databases: {},
			groups: {},
			schemaTables: {},
			sections: { 'saved-queries': false, 'recent-queries': false }
		}
	});

	function getExplorerExpansion(clusterId: string) {
		const existing = explorerExpansionByCluster[clusterId];
		if (existing) return existing;

		const expansion: ExplorerExpansionState = {
			databases: {},
			groups: {},
			schemaTables: {},
			sections: { 'saved-queries': false, 'recent-queries': false }
		};
		explorerExpansionByCluster[clusterId] = expansion;
		return expansion;
	}

	function setExplorerExpansion(clusterId: string, change: ExplorerExpansionChange) {
		const expansion = getExplorerExpansion(clusterId);
		if (change.type === 'database') {
			expansion.databases[change.database] = change.open;
		} else if (change.type === 'group') {
			expansion.groups[`${change.database}:${change.group}`] = change.open;
		} else if (change.type === 'schema-table') {
			let databaseTables = expansion.schemaTables[change.database];
			if (!databaseTables) {
				databaseTables = {};
				expansion.schemaTables[change.database] = databaseTables;
			}
			databaseTables[change.table] = change.open;
		} else {
			expansion.sections[change.section] = change.open;
		}
	}

	function getQueryTab(id: string) {
		return queryTabs.find((tab) => tab.id === id);
	}

	function createQueryTab(
		database: string,
		query = '',
		savedQuery: Pick<QueryTab, 'savedQueryId' | 'savedQueryName'> = {}
	) {
		const tab: QueryTab = {
			id: createQueryTabId(),
			database,
			query,
			isRunning: false,
			...savedQuery
		};
		queryTabs = [...queryTabs, tab];
		activeQueryTabId = tab.id;
		return tab;
	}

	function updateQueryTab(id: string, update: Partial<Omit<QueryTab, 'id'>>) {
		const tab = getQueryTab(id);
		if (tab) Object.assign(tab, update);
	}

	function closeQueryTab(id: string) {
		if (queryTabs.length === 1) {
			const tab = queryTabs[0];
			tab.database = '';
			tab.query = '';
			tab.result = undefined;
			tab.error = undefined;
			tab.errorRequestId = undefined;
			tab.errorRaw = undefined;
			tab.savedQueryId = undefined;
			tab.savedQueryName = undefined;
			return;
		}

		const index = queryTabs.findIndex((tab) => tab.id === id);
		if (index === -1) return;
		queryTabs = queryTabs.filter((tab) => tab.id !== id);
		if (activeQueryTabId === id) {
			activeQueryTabId = queryTabs[Math.max(0, index - 1)].id;
		}
	}

	function resetQueryTabs(database = '') {
		const tab: QueryTab = { id: createQueryTabId(), database, query: '', isRunning: false };
		queryTabs = [tab];
		activeQueryTabId = tab.id;
	}

	return {
		get activeClusterId() {
			return activeClusterId;
		},
		set activeClusterId(value: string) {
			activeClusterId = value;
		},
		get databaseSchema() {
			return databaseSchema;
		},
		set databaseSchema(value: KustoDatabaseSchema | undefined) {
			databaseSchema = value;
		},
		get selectedDatabase() {
			return selectedDatabase;
		},
		set selectedDatabase(value: string) {
			selectedDatabase = value;
		},
		get selectedTable() {
			return selectedTable;
		},
		set selectedTable(value: string | undefined) {
			selectedTable = value;
		},
		get selectedFunction() {
			return selectedFunction;
		},
		set selectedFunction(value: string | undefined) {
			selectedFunction = value;
		},
		get pendingQuery() {
			return pendingQuery;
		},
		set pendingQuery(value: string | undefined) {
			pendingQuery = value;
		},
		get queryTabs() {
			return queryTabs;
		},
		get activeQueryTabId() {
			return activeQueryTabId;
		},
		set activeQueryTabId(value: string) {
			if (getQueryTab(value)) activeQueryTabId = value;
		},
		getQueryTab,
		createQueryTab,
		updateQueryTab,
		closeQueryTab,
		resetQueryTabs,
		getExplorerExpansion,
		setExplorerExpansion
	};
}

export function setClusterSession(session: ClusterSession) {
	setContext(CLUSTER_SESSION, session);
}

export function getClusterSession(): ClusterSession {
	const session = getContext<ClusterSession>(CLUSTER_SESSION);
	if (!session) throw new Error('Cluster session has not been initialized.');
	return session;
}
