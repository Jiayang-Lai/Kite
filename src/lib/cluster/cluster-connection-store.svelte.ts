import { browser } from '$app/environment';
import { getContext, setContext } from 'svelte';

import { getKustoClusters, type KustoClusterConnection } from '$lib/kusto/query-client';

const CLUSTER_CONNECTION_STORE = Symbol('cluster-connection-store');
const STORAGE_KEY = 'kite:cluster-connections:v1';

export type NewClusterConnection = {
	name: string;
	url: string;
	description?: string;
};

export type ClusterConnectionStore = {
	readonly clusters: KustoClusterConnection[];
	readonly customClusters: KustoClusterConnection[];
	hydrate: () => void;
	add: (draft: NewClusterConnection) => KustoClusterConnection;
	update: (clusterId: string, draft: NewClusterConnection) => KustoClusterConnection;
	remove: (clusterId: string) => void;
};

function normalizeClusterUrl(value: string) {
	const input = value.trim();
	let url: URL;

	try {
		url = new URL(input);
	} catch {
		throw new Error('Enter a valid cluster URL.');
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Cluster URL must use HTTP or HTTPS.');
	}
	if (url.username || url.password) {
		throw new Error('Cluster URL must not include credentials.');
	}

	url.hash = '';
	url.search = '';
	return url.toString().replace(/\/$/, '');
}

function parseStoredCluster(value: unknown): KustoClusterConnection | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const cluster = value as Record<string, unknown>;

	if (
		typeof cluster.id !== 'string' ||
		typeof cluster.name !== 'string' ||
		typeof cluster.url !== 'string' ||
		cluster.kind !== 'remote'
	) {
		return undefined;
	}

	try {
		const name = cluster.name.trim();
		if (!name) return undefined;
		const description =
			typeof cluster.description === 'string' ? cluster.description.trim() || undefined : undefined;
		return {
			id: cluster.id,
			name,
			description,
			url: normalizeClusterUrl(cluster.url),
			kind: 'remote'
		};
	} catch {
		return undefined;
	}
}

function createClusterId() {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`cluster-${Date.now()}-${Math.random().toString(36).slice(2)}`
	);
}

/** Creates the browser-local catalog used by every cluster switcher in the app. */
export function createClusterConnectionStore(): ClusterConnectionStore {
	const builtInClusters = getKustoClusters();
	const builtInIds = new Set(builtInClusters.map((cluster) => cluster.id));
	let clusters = $state<KustoClusterConnection[]>(builtInClusters);
	let hydrated = false;

	function persist(nextClusters: KustoClusterConnection[]) {
		if (!browser) return;
		const customClusters = nextClusters.filter((item) => !builtInIds.has(item.id));
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(customClusters));
		} catch {
			throw new Error('Cluster changes could not be saved in browser storage.');
		}
	}

	function prepareCluster(draft: NewClusterConnection, id: string = createClusterId()) {
		const name = draft.name.trim();
		if (!name) throw new Error('Enter a cluster name.');

		return {
			id,
			name,
			description: draft.description?.trim() || undefined,
			url: normalizeClusterUrl(draft.url),
			kind: 'remote' as const
		};
	}

	function hydrate() {
		if (!browser || hydrated) return;
		hydrated = true;

		try {
			const serialized = localStorage.getItem(STORAGE_KEY);
			if (!serialized) return;
			const parsed: unknown = JSON.parse(serialized);
			if (!Array.isArray(parsed)) return;

			const seenIds = new Set(builtInIds);
			const storedClusters: KustoClusterConnection[] = [];
			for (const value of parsed) {
				const cluster = parseStoredCluster(value);
				if (!cluster || seenIds.has(cluster.id)) continue;
				seenIds.add(cluster.id);
				storedClusters.push(cluster);
			}
			clusters = [...builtInClusters, ...storedClusters];
		} catch {
			// Keep the built-in catalog available when browser storage is unreadable.
		}
	}

	function add(draft: NewClusterConnection) {
		const cluster = prepareCluster(draft);
		const nextClusters = [...clusters, cluster];
		persist(nextClusters);
		clusters = nextClusters;
		return cluster;
	}

	function update(clusterId: string, draft: NewClusterConnection) {
		if (builtInIds.has(clusterId)) throw new Error('Built-in clusters cannot be edited.');
		if (!clusters.some((cluster) => cluster.id === clusterId)) {
			throw new Error('This cluster no longer exists.');
		}

		const cluster = prepareCluster(draft, clusterId);
		const nextClusters = clusters.map((item) => (item.id === clusterId ? cluster : item));
		persist(nextClusters);
		clusters = nextClusters;
		return cluster;
	}

	function remove(clusterId: string) {
		if (builtInIds.has(clusterId)) throw new Error('Built-in clusters cannot be removed.');
		if (!clusters.some((cluster) => cluster.id === clusterId)) return;

		const nextClusters = clusters.filter((cluster) => cluster.id !== clusterId);
		persist(nextClusters);
		clusters = nextClusters;
	}

	return {
		get clusters() {
			return clusters;
		},
		get customClusters() {
			return clusters.filter((cluster) => !builtInIds.has(cluster.id));
		},
		hydrate,
		add,
		update,
		remove
	};
}

export function setClusterConnectionStore(store: ClusterConnectionStore) {
	setContext(CLUSTER_CONNECTION_STORE, store);
}

export function getClusterConnectionStore(): ClusterConnectionStore {
	const store = getContext<ClusterConnectionStore>(CLUSTER_CONNECTION_STORE);
	if (!store) throw new Error('Cluster connection store has not been initialized.');
	return store;
}
