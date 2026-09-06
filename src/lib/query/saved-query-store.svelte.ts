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
	save: (draft: SavedQueryDraft) => SavedQuery | undefined;
	update: (id: string, draft: SavedQueryDraft) => SavedQuery | undefined;
	remove: (id: string) => boolean;
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

	function persist(next: SavedQuery[]) {
		if (!browser) return true;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			storageError = undefined;
			return true;
		} catch {
			storageError = 'Saved queries could not be stored locally.';
			return false;
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
		const next = [savedQuery, ...queries];
		if (!persist(next)) return undefined;
		queries = next;
		return savedQuery;
	}

	function remove(id: string) {
		const next = queries.filter((query) => query.id !== id);
		if (!persist(next)) return false;
		queries = next;
		return true;
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
		const next = queries.map((query) => (query.id === id ? updatedQuery : query));
		if (!persist(next)) return undefined;
		queries = next;
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
