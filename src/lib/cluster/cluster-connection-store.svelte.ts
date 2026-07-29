import { browser } from '$app/environment';
import { getContext, setContext } from 'svelte';

import {
	createStarterMockSchema,
	getMockClusterSchema,
	normalizeMockSchema
} from '$lib/cluster/mock-cluster-schema';
import {
	EMULATED_KUSTO_CLUSTER_URL,
	getKustoClusters,
	MOCK_KUSTO_CLUSTER_URL,
	type KustoClusterConnection
} from '$lib/kusto/query-client';
import {
	createEmulatedStorage,
	normalizeEmulatedStorage,
	registerEmulatedStorage,
	unregisterEmulatedStorage,
	type EmulatedStorageMode
} from '$lib/emulated/storage';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

const CLUSTER_CONNECTION_STORE = Symbol('cluster-connection-store');
const STORAGE_KEY = 'kite:cluster-connections:v1';

type ClusterConnectionDraft = {
	name: string;
	description?: string;
};

export type NewClusterConnection =
	| (ClusterConnectionDraft & {
			kind: 'remote';
			url: string;
	  })
	| (ClusterConnectionDraft & {
			kind: 'mock';
			url?: never;
			mockSchema: KustoDatabaseSchema;
	  })
	| (ClusterConnectionDraft & {
			kind: 'emulated';
			url?: never;
			storageMode?: EmulatedStorageMode;
	  });

export type ClusterConnectionStore = {
	readonly clusters: KustoClusterConnection[];
	readonly customClusters: KustoClusterConnection[];
	hydrate: () => void;
	add: (draft: NewClusterConnection) => KustoClusterConnection;
	update: (clusterId: string, draft: NewClusterConnection) => KustoClusterConnection;
	updateMockSchema: (
		clusterId: string,
		expectedRevision: number,
		mutation: (schema: KustoDatabaseSchema) => KustoDatabaseSchema
	) => KustoClusterConnection;
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
		(cluster.kind !== 'remote' && cluster.kind !== 'mock' && cluster.kind !== 'emulated')
	) {
		return undefined;
	}
	if (cluster.kind === 'remote' && typeof cluster.url !== 'string') return undefined;

	try {
		const name = cluster.name.trim();
		if (!name) return undefined;
		const description =
			typeof cluster.description === 'string' ? cluster.description.trim() || undefined : undefined;
		if (cluster.kind === 'mock') {
			return {
				id: cluster.id,
				name,
				description,
				url: createMockClusterUrl(cluster.id),
				kind: 'mock',
				mockSchema: normalizeMockSchema(cluster.mockSchema ?? createStarterMockSchema()),
				mockSchemaRevision:
					typeof cluster.mockSchemaRevision === 'number' &&
					Number.isInteger(cluster.mockSchemaRevision) &&
					cluster.mockSchemaRevision >= 0
						? cluster.mockSchemaRevision
						: 0
			};
		}
		if (cluster.kind === 'emulated') {
			return {
				id: cluster.id,
				name,
				description,
				url: createEmulatedClusterUrl(cluster.id),
				kind: 'emulated',
				emulatedStorage: normalizeEmulatedStorage(cluster.emulatedStorage, cluster.id)
			};
		}
		return {
			id: cluster.id,
			name,
			description,
			url: normalizeClusterUrl(cluster.url as string),
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

function createMockClusterUrl(clusterId: string) {
	return `${MOCK_KUSTO_CLUSTER_URL}/${encodeURIComponent(clusterId)}`;
}

function createEmulatedClusterUrl(clusterId: string) {
	return `${EMULATED_KUSTO_CLUSTER_URL}/${encodeURIComponent(clusterId)}`;
}

/** Creates the browser-local catalog used by every cluster switcher in the app. */
export function createClusterConnectionStore(): ClusterConnectionStore {
	const builtInClusters = getKustoClusters();
	const builtInIds = new Set(builtInClusters.map((cluster) => cluster.id));
	let clusters = $state<KustoClusterConnection[]>(builtInClusters);
	let hydrated = false;

	function registerClusterStorage(nextClusters: KustoClusterConnection[]) {
		for (const cluster of nextClusters) {
			if (cluster.kind === 'emulated') {
				registerEmulatedStorage(cluster.id, cluster.emulatedStorage);
			}
		}
	}

	registerClusterStorage(builtInClusters);

	function persist(nextClusters: KustoClusterConnection[]) {
		if (!browser) return;
		const storedClusters = nextClusters.filter(
			(item) => !builtInIds.has(item.id) || (item.kind === 'mock' && item.mockSchema !== undefined)
		);
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(storedClusters));
		} catch {
			throw new Error('Cluster changes could not be saved in browser storage.');
		}
	}

	function prepareCluster(
		draft: NewClusterConnection,
		id: string = createClusterId(),
		mockSchemaRevision = 0
	) {
		const name = draft.name.trim();
		if (!name) throw new Error('Enter a cluster name.');

		if (draft.kind === 'mock') {
			return {
				id,
				name,
				description: draft.description?.trim() || undefined,
				url: createMockClusterUrl(id),
				kind: 'mock' as const,
				mockSchema: normalizeMockSchema(draft.mockSchema),
				mockSchemaRevision
			};
		}
		if (draft.kind === 'emulated') {
			return {
				id,
				name,
				description: draft.description?.trim() || undefined,
				url: createEmulatedClusterUrl(id),
				kind: 'emulated' as const,
				emulatedStorage: createEmulatedStorage(draft.storageMode ?? 'opfs', id)
			};
		}

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

			const hydratedBuiltIns = [...builtInClusters];
			const seenIds = new Set(builtInIds);
			const storedClusters: KustoClusterConnection[] = [];
			for (const value of parsed) {
				const cluster = parseStoredCluster(value);
				if (!cluster) continue;
				if (builtInIds.has(cluster.id)) {
					const builtInIndex = hydratedBuiltIns.findIndex((item) => item.id === cluster.id);
					const builtInCluster = hydratedBuiltIns[builtInIndex];
					if (builtInCluster?.kind === 'mock' && cluster.kind === 'mock') {
						hydratedBuiltIns[builtInIndex] = {
							...builtInCluster,
							mockSchema: cluster.mockSchema,
							mockSchemaRevision: cluster.mockSchemaRevision
						};
					}
					continue;
				}
				if (seenIds.has(cluster.id)) continue;
				seenIds.add(cluster.id);
				storedClusters.push(cluster);
			}
			clusters = [...hydratedBuiltIns, ...storedClusters];
			registerClusterStorage(clusters);
		} catch {
			// Keep the built-in catalog available when browser storage is unreadable.
		}
	}

	function add(draft: NewClusterConnection) {
		const cluster = prepareCluster(draft);
		const nextClusters = [...clusters, cluster];
		persist(nextClusters);
		clusters = nextClusters;
		if (cluster.kind === 'emulated') {
			registerEmulatedStorage(cluster.id, cluster.emulatedStorage);
		}
		return cluster;
	}

	function update(clusterId: string, draft: NewClusterConnection) {
		if (builtInIds.has(clusterId)) throw new Error('Built-in clusters cannot be edited.');
		if (!clusters.some((cluster) => cluster.id === clusterId)) {
			throw new Error('This cluster no longer exists.');
		}

		const existingCluster = clusters.find((cluster) => cluster.id === clusterId)!;
		if (
			existingCluster.kind === 'emulated' &&
			draft.kind === 'emulated' &&
			(draft.storageMode ?? existingCluster.emulatedStorage?.mode ?? 'memory') !==
				(existingCluster.emulatedStorage?.mode ?? 'memory')
		) {
			throw new Error('Emulated cluster storage cannot be changed after the cluster is created.');
		}
		const mockSchemaRevision =
			draft.kind === 'mock'
				? existingCluster.kind === 'mock'
					? (existingCluster.mockSchemaRevision ?? 0) + 1
					: 0
				: 0;
		const cluster =
			draft.kind === 'emulated' && existingCluster.kind === 'emulated'
				? {
						...prepareCluster(draft, clusterId, mockSchemaRevision),
						emulatedStorage:
							existingCluster.emulatedStorage ?? createEmulatedStorage('memory', clusterId)
					}
				: prepareCluster(draft, clusterId, mockSchemaRevision);
		const nextClusters = clusters.map((item) => (item.id === clusterId ? cluster : item));
		persist(nextClusters);
		clusters = nextClusters;
		if (existingCluster.kind === 'emulated' && cluster.kind !== 'emulated') {
			unregisterEmulatedStorage(clusterId);
		} else if (cluster.kind === 'emulated') {
			registerEmulatedStorage(clusterId, cluster.emulatedStorage);
		}
		return cluster;
	}

	function updateMockSchema(
		clusterId: string,
		expectedRevision: number,
		mutation: (schema: KustoDatabaseSchema) => KustoDatabaseSchema
	) {
		const cluster = clusters.find((item) => item.id === clusterId);
		if (!cluster) throw new Error('This cluster no longer exists.');
		if (cluster.kind !== 'mock') throw new Error('Remote cluster schemas are managed by Kusto.');

		const currentRevision = cluster.mockSchemaRevision ?? 0;
		if (currentRevision !== expectedRevision) {
			throw new Error(
				'The mock schema changed while this editor was open. Review the refreshed schema and try again.'
			);
		}

		const updatedCluster: KustoClusterConnection = {
			...cluster,
			mockSchema: normalizeMockSchema(mutation(getMockClusterSchema(cluster))),
			mockSchemaRevision: currentRevision + 1
		};
		const nextClusters = clusters.map((item) => (item.id === clusterId ? updatedCluster : item));
		persist(nextClusters);
		clusters = nextClusters;
		return updatedCluster;
	}

	function remove(clusterId: string) {
		if (builtInIds.has(clusterId)) throw new Error('Built-in clusters cannot be removed.');
		if (!clusters.some((cluster) => cluster.id === clusterId)) return;

		const nextClusters = clusters.filter((cluster) => cluster.id !== clusterId);
		persist(nextClusters);
		clusters = nextClusters;
		unregisterEmulatedStorage(clusterId);
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
		updateMockSchema,
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
