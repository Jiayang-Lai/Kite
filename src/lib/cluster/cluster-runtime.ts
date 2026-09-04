import {
	disposeAllDuckDbSessions,
	disposeDuckDb,
	disposeInactiveDuckDbSessions
} from '$lib/duckdb/lazy-client';
import { loadEmulatedSchema, startEmulatedQuery } from '$lib/emulation/cluster';
import { registerEmulatedStorage } from '$lib/emulation/storage';
import { loadBackendSchema } from '$lib/kusto/backend-schema';
import { startKustoQuery } from '$lib/kusto/query-client';
import { loadLogAnalyticsSchema, startLogAnalyticsQuery } from '$lib/log-analytics/client';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
import type { QueryExecution } from '$lib/types/query-result';
import { getConnectionCapabilities, type ConnectionCapabilities } from './connection-capabilities';
import type { ClusterConnectionOfKind, ClusterKind, KustoClusterConnection } from './connections';
import { getMockClusterSchema } from './mock-cluster-schema';

export type { ClusterConnectionOfKind, ClusterKind } from './connections';

let transitionQueue = Promise.resolve();

function enqueueTransition<T>(transition: () => Promise<T>): Promise<T> {
	const result = transitionQueue.then(transition, transition);
	transitionQueue = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}

/** Backend contract implemented by every supported cluster kind. */
export interface ClusterDriver<K extends ClusterKind = ClusterKind> {
	readonly kind: K;
	capabilities(cluster: ClusterConnectionOfKind<K>): ConnectionCapabilities;
	loadSchema(cluster: ClusterConnectionOfKind<K>): Promise<KustoDatabaseSchema>;
	startQuery(cluster: ClusterConnectionOfKind<K>, database: string, query: string): QueryExecution;
	dispose(cluster: ClusterConnectionOfKind<K>): Promise<void>;
}

type ClusterDriverRegistry = { [K in ClusterKind]: ClusterDriver<K> };

const clusterDrivers = {
	remote: {
		kind: 'remote',
		capabilities: getConnectionCapabilities,
		async loadSchema(cluster) {
			const schema = await loadBackendSchema(cluster.url);
			await disposeInactiveDuckDbSessions();
			return schema;
		},
		startQuery: (cluster, database, query) => startKustoQuery(database, query, cluster.url),
		dispose: async () => undefined
	},
	'log-analytics': {
		kind: 'log-analytics',
		capabilities: getConnectionCapabilities,
		async loadSchema(cluster) {
			const schema = await loadLogAnalyticsSchema(cluster.logAnalytics, cluster.name);
			await disposeInactiveDuckDbSessions();
			return schema;
		},
		startQuery: (cluster, _database, query) => startLogAnalyticsQuery(cluster.logAnalytics, query),
		dispose: async () => undefined
	},
	mock: {
		kind: 'mock',
		capabilities: getConnectionCapabilities,
		async loadSchema(cluster) {
			const schema = getMockClusterSchema(cluster);
			await disposeInactiveDuckDbSessions();
			return schema;
		},
		startQuery() {
			throw new Error('Queries are unavailable for this connection.');
		},
		dispose: async () => undefined
	},
	emulated: {
		kind: 'emulated',
		capabilities: getConnectionCapabilities,
		async loadSchema(cluster) {
			registerEmulatedStorage(cluster.id, cluster.emulatedStorage);
			await disposeInactiveDuckDbSessions(cluster.id);
			return loadEmulatedSchema(cluster.id);
		},
		startQuery: (cluster, database, query) => startEmulatedQuery(cluster.id, database, query),
		dispose: (cluster) => disposeDuckDb(cluster.id)
	}
} satisfies ClusterDriverRegistry;

/** Resolves the typed backend driver for a validated connection. */
export function getClusterDriver<K extends ClusterKind>(
	cluster: ClusterConnectionOfKind<K>
): ClusterDriver<K> {
	// TypeScript cannot preserve the key/value correlation when indexing a mapped registry.
	return clusterDrivers[cluster.kind] as unknown as ClusterDriver<K>;
}

export interface ConnectionRuntime {
	kind: ClusterKind;
	capabilities: ConnectionCapabilities;
	loadSchema: () => Promise<KustoDatabaseSchema>;
	startQuery: (database: string, query: string) => QueryExecution;
	dispose: () => Promise<void>;
}

/** Creates the uniform runtime exposed by every saved connection. */
export function createConnectionRuntime(cluster: KustoClusterConnection): ConnectionRuntime {
	const driver = getClusterDriver(cluster);
	return {
		kind: cluster.kind,
		capabilities: driver.capabilities(cluster),
		loadSchema: () => enqueueTransition(() => driver.loadSchema(cluster)),
		startQuery: (database, query) => driver.startQuery(cluster, database, query),
		dispose: () => enqueueTransition(() => driver.dispose(cluster))
	};
}

/** Releases one DuckDB runtime by ID when only persisted cleanup metadata remains. */
export function releaseClusterRuntime(clusterId: string): Promise<void> {
	return enqueueTransition(() => disposeDuckDb(clusterId));
}

/** Releases all DuckDB workers when the application workspace is left. */
export function releaseAllClusterRuntimes(): Promise<void> {
	return enqueueTransition(() => disposeAllDuckDbSessions());
}
