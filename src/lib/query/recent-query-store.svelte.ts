import { browser } from '$app/environment';
import { getContext, setContext } from 'svelte';

const RECENT_QUERY_STORE = Symbol('recent-query-store');
const STORAGE_KEY = 'kite:recent-queries:v1';
const MAX_RECENT_QUERIES = 3;

export type RecentQuery = {
	id: string;
	clusterId: string;
	database: string;
	name: string;
	query: string;
	executedAt: string;
};

export type RecentQueryDraft = Pick<RecentQuery, 'clusterId' | 'database' | 'name' | 'query'>;

export type RecentQueryStore = {
	readonly queries: RecentQuery[];
	hydrate: () => void;
	record: (draft: RecentQueryDraft) => RecentQuery;
	remove: (id: string) => void;
	forCluster: (clusterId: string) => RecentQuery[];
};

function isRecentQuery(value: unknown): value is RecentQuery {
	if (!value || typeof value !== 'object') return false;
	const query = value as Record<string, unknown>;
	return (
		typeof query.id === 'string' &&
		typeof query.clusterId === 'string' &&
		typeof query.database === 'string' &&
		typeof query.name === 'string' &&
		typeof query.query === 'string' &&
		typeof query.executedAt === 'string'
	);
}

function createRecentQueryId() {
	return globalThis.crypto?.randomUUID?.() ?? `recent-query-${Date.now()}-${Math.random()}`;
}

/** Creates the client-persisted, three-item query history shared by the app workspaces. */
export function createRecentQueryStore(): RecentQueryStore {
	let queries = $state<RecentQuery[]>([]);
	let hydrated = false;

	function persist() {
		if (!browser) return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
		} catch {
			// Query execution remains available if browser storage is unavailable.
		}
	}

	function hydrate() {
		if (!browser || hydrated) return;
		hydrated = true;

		try {
			const serialized = localStorage.getItem(STORAGE_KEY);
			if (!serialized) return;
			const parsed = JSON.parse(serialized);
			if (Array.isArray(parsed))
				queries = parsed.filter(isRecentQuery).slice(0, MAX_RECENT_QUERIES);
		} catch {
			// Treat malformed local history as empty.
		}
	}

	function record(draft: RecentQueryDraft) {
		const timestamp = new Date().toISOString();
		const existing = queries.find(
			(query) =>
				query.clusterId === draft.clusterId &&
				query.database === draft.database &&
				query.query === draft.query
		);
		const recentQuery: RecentQuery = {
			id: existing?.id ?? createRecentQueryId(),
			clusterId: draft.clusterId,
			database: draft.database,
			name: draft.name,
			query: draft.query,
			executedAt: timestamp
		};

		queries = [recentQuery, ...queries.filter((query) => query.id !== recentQuery.id)].slice(
			0,
			MAX_RECENT_QUERIES
		);
		persist();
		return recentQuery;
	}

	function remove(id: string) {
		queries = queries.filter((query) => query.id !== id);
		persist();
	}

	return {
		get queries() {
			return queries;
		},
		hydrate,
		record,
		remove,
		forCluster(clusterId) {
			return queries.filter((query) => query.clusterId === clusterId);
		}
	};
}

export function setRecentQueryStore(store: RecentQueryStore) {
	setContext(RECENT_QUERY_STORE, store);
}

export function getRecentQueryStore(): RecentQueryStore {
	const store = getContext<RecentQueryStore>(RECENT_QUERY_STORE);
	if (!store) throw new Error('Recent query store has not been initialized.');
	return store;
}
