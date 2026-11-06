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
	isSchemaFresh: (clusterId: string, maxAgeMs: number) => boolean;
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
	/** The connection's Explorer expansion; reading it never changes state, so it can be derived. */
	getExplorerExpansion: (clusterId: string) => ExplorerExpansionState;
	setExplorerExpansion: (clusterId: string, change: ExplorerExpansionChange) => void;
};

function emptyExplorerExpansion(): ExplorerExpansionState {
	return {
		databases: {},
		groups: {},
		schemaTables: {},
		sections: { 'saved-queries': false, 'recent-queries': false }
	};
}

/** Creates the app-wide, confirmed cluster selection shared by feature pages. */
export function createClusterSession(initialClusterId: string): ClusterSession {
	let nextQueryTabId = 0;
	const emptyQueryTab = (database = ''): QueryTab => ({
		id: `query-tab-${++nextQueryTabId}`,
		database,
		query: '',
		isRunning: false
	});
	let activeClusterId = $state(initialClusterId);
	let databaseSchema = $state.raw<KustoDatabaseSchema>();
	let schemaClusterId = $state<string>();
	let schemaLoadedAt = $state(0);
	let selectedDatabase = $state('');
	let selectedTable = $state<string>();
	let selectedFunction = $state<string>();
	let pendingQuery = $state<string>();
	const initialQueryTab = emptyQueryTab();
	let queryTabs = $state<QueryTab[]>([initialQueryTab]);
	let activeQueryTabId = $state(initialQueryTab.id);
	const explorerExpansionByCluster = $state<Record<string, ExplorerExpansionState>>({});
	const collapsedExplorer = emptyExplorerExpansion();

	function getExplorerExpansion(clusterId: string) {
		return explorerExpansionByCluster[clusterId] ?? collapsedExplorer;
	}

	function setExplorerExpansion(clusterId: string, change: ExplorerExpansionChange) {
		// Read the entry back after storing it: writes must go through the state proxy.
		explorerExpansionByCluster[clusterId] ??= emptyExplorerExpansion();
		const expansion = explorerExpansionByCluster[clusterId];
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
		const tab: QueryTab = { ...emptyQueryTab(database), query, ...savedQuery };
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
			// Replace, rather than clear, the final tab. The editor is keyed by tab ID and
			// deliberately does not sync external values while the user types; retaining the
			// ID would leave its old visible content in place after the tab has been cleared.
			resetQueryTabs();
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
		const tab = emptyQueryTab(database);
		queryTabs = [tab];
		activeQueryTabId = tab.id;
	}

	function isSchemaFresh(clusterId: string, maxAgeMs: number) {
		return (
			Boolean(databaseSchema) &&
			schemaClusterId === clusterId &&
			Date.now() - schemaLoadedAt < maxAgeMs
		);
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
			schemaClusterId = value ? activeClusterId : undefined;
			schemaLoadedAt = value ? Date.now() : 0;
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
		isSchemaFresh,
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
