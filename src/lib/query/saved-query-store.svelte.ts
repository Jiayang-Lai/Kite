import { browser } from '$app/environment';
import { getContext, setContext } from 'svelte';

const SAVED_QUERY_STORE = Symbol('saved-query-store');
const STORAGE_KEY = 'kite:saved-queries:v1';

export type SavedQuery = {
	id: string;
	clusterId: string;
	database: string;
	name: string;
	query: string;
	createdAt: string;
	updatedAt: string;
};

export type SavedQueryDraft = Pick<SavedQuery, 'clusterId' | 'database' | 'name' | 'query'>;

export type SavedQueryStore = {
	readonly queries: SavedQuery[];
	readonly storageError: string | undefined;
	hydrate: () => void;
	save: (draft: SavedQueryDraft) => SavedQuery;
	update: (id: string, draft: SavedQueryDraft) => SavedQuery | undefined;
	remove: (id: string) => void;
	forCluster: (clusterId: string) => SavedQuery[];
};

function isSavedQuery(value: unknown): value is SavedQuery {
	if (!value || typeof value !== 'object') return false;
	const query = value as Record<string, unknown>;
	return (
		typeof query.id === 'string' &&
		typeof query.clusterId === 'string' &&
		typeof query.database === 'string' &&
		typeof query.name === 'string' &&
		typeof query.query === 'string' &&
		typeof query.createdAt === 'string' &&
		typeof query.updatedAt === 'string'
	);
}

function createSavedQueryId() {
	return globalThis.crypto?.randomUUID?.() ?? `saved-query-${Date.now()}-${Math.random()}`;
}

/** Creates the client-persisted saved-query collection shared by the app workspaces. */
export function createSavedQueryStore(): SavedQueryStore {
	let queries = $state<SavedQuery[]>([]);
	let storageError = $state<string>();
	let hydrated = false;

	function persist() {
		if (!browser) return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
			storageError = undefined;
		} catch {
			storageError = 'Saved queries could not be stored locally.';
		}
	}

	function hydrate() {
		if (!browser || hydrated) return;
		hydrated = true;

		try {
			const serialized = localStorage.getItem(STORAGE_KEY);
			if (!serialized) return;
			const parsed = JSON.parse(serialized);
			if (!Array.isArray(parsed)) throw new Error('Invalid saved-query collection.');
			queries = parsed.filter(isSavedQuery);
			if (queries.length !== parsed.length) {
				storageError = 'Some invalid saved queries were ignored.';
			}
		} catch {
			storageError = 'Saved queries could not be loaded from local storage.';
		}
	}

	function save(draft: SavedQueryDraft) {
		const timestamp = new Date().toISOString();
		const savedQuery: SavedQuery = {
			id: createSavedQueryId(),
			clusterId: draft.clusterId,
			database: draft.database,
			name: draft.name.trim(),
			query: draft.query.trim(),
			createdAt: timestamp,
			updatedAt: timestamp
		};
		queries = [savedQuery, ...queries];
		persist();
		return savedQuery;
	}

	function remove(id: string) {
		queries = queries.filter((query) => query.id !== id);
		persist();
	}

	function update(id: string, draft: SavedQueryDraft) {
		const existing = queries.find((query) => query.id === id);
		if (!existing) return undefined;

		const updatedQuery: SavedQuery = {
			...existing,
			clusterId: draft.clusterId,
			database: draft.database,
			name: draft.name.trim(),
			query: draft.query.trim(),
			updatedAt: new Date().toISOString()
		};
		queries = queries.map((query) => (query.id === id ? updatedQuery : query));
		persist();
		return updatedQuery;
	}

	return {
		get queries() {
			return queries;
		},
		get storageError() {
			return storageError;
		},
		hydrate,
		save,
		update,
		remove,
		forCluster(clusterId) {
			return queries
				.filter((query) => query.clusterId === clusterId)
				.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
		}
	};
}

export function setSavedQueryStore(store: SavedQueryStore) {
	setContext(SAVED_QUERY_STORE, store);
}

export function getSavedQueryStore(): SavedQueryStore {
	const store = getContext<SavedQueryStore>(SAVED_QUERY_STORE);
	if (!store) throw new Error('Saved query store has not been initialized.');
	return store;
}
