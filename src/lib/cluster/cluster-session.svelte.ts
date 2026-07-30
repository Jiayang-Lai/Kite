import { getContext, setContext } from 'svelte';

import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

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

export type ClusterSession = {
	activeClusterId: string;
	databaseSchema?: KustoDatabaseSchema;
	selectedDatabase: string;
	selectedTable?: string;
	selectedFunction?: string;
	pendingQuery?: string;
	getExplorerExpansion: (clusterId: string) => ExplorerExpansionState;
	setExplorerExpansion: (clusterId: string, change: ExplorerExpansionChange) => void;
};

/** Creates the app-wide, confirmed cluster selection shared by feature pages. */
export function createClusterSession(initialClusterId: string): ClusterSession {
	let activeClusterId = $state(initialClusterId);
	let databaseSchema = $state.raw<KustoDatabaseSchema>();
	let selectedDatabase = $state('');
	let selectedTable = $state<string>();
	let selectedFunction = $state<string>();
	let pendingQuery = $state<string>();
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
