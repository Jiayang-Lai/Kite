import {
	disposeAllDuckDbSessions,
	disposeDuckDb,
	disposeInactiveDuckDbSessions
} from '$lib/duckdb/lazy-client';
import { loadEmulatedSchema, startEmulatedQuery } from '$lib/emulation/cluster';
import { registerEmulatedStorage } from '$lib/emulation/storage';
import { loadBackendSchema } from '$lib/kusto/backend-schema';
import { loadLogAnalyticsSchema, startLogAnalyticsQuery } from '$lib/log-analytics/client';
import { startKustoQuery, type KustoClusterConnection } from '$lib/kusto/query-client';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
import type { QueryExecution } from '$lib/types/query-result';
import { getMockClusterSchema } from './mock-cluster-schema';
import { getConnectionCapabilities, type ConnectionCapabilities } from './connection-capabilities';

let transitionQueue = Promise.resolve();

function enqueueTransition<T>(transition: () => Promise<T>): Promise<T> {
	const result = transitionQueue.then(transition, transition);
	transitionQueue = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}

export type ConnectionRuntime = {
	capabilities: ConnectionCapabilities;
	loadSchema: () => Promise<KustoDatabaseSchema>;
	startQuery: (database: string, query: string) => QueryExecution;
};

/** Creates the backend operations available to one saved connection. */
export function createConnectionRuntime(cluster: KustoClusterConnection): ConnectionRuntime {
	const capabilities = getConnectionCapabilities(cluster);

	return {
		capabilities,
		loadSchema: () => loadConnectionSchema(cluster, capabilities),
		startQuery: (database, query) => startConnectionQuery(cluster, capabilities, database, query)
	};
}

/**
 * Loads one cluster schema while enforcing a single live DuckDB session.
 *
 * Remote connections are validated before the previous emulated session is
 * released. Emulated connections release inactive workers first so their WASM
 * allocations never overlap.
 */
function loadConnectionSchema(
	cluster: KustoClusterConnection,
	capabilities: ConnectionCapabilities
): Promise<KustoDatabaseSchema> {
	return enqueueTransition(async () => {
		switch (capabilities.schemaLoader) {
			case 'emulated':
				registerEmulatedStorage(cluster.id, cluster.emulatedStorage);
				await disposeInactiveDuckDbSessions(cluster.id);
				return loadEmulatedSchema(cluster.id);
			case 'log-analytics':
				if (!cluster.logAnalytics)
					throw new Error('Log Analytics connection settings are missing.');
				const schema = await loadLogAnalyticsSchema(cluster.logAnalytics, cluster.name);
				await disposeInactiveDuckDbSessions();
				return schema;
			case 'mock':
				const mockSchema = getMockClusterSchema(cluster);
				await disposeInactiveDuckDbSessions();
				return mockSchema;
			case 'backend':
				const backendSchema = await loadBackendSchema(cluster.url);
				await disposeInactiveDuckDbSessions();
				return backendSchema;
		}
	});
}

function startConnectionQuery(
	cluster: KustoClusterConnection,
	capabilities: ConnectionCapabilities,
	database: string,
	query: string
): QueryExecution {
	switch (capabilities.queryExecutor) {
		case 'emulated':
			return startEmulatedQuery(cluster.id, database, query);
		case 'log-analytics':
			if (!cluster.logAnalytics) throw new Error('Log Analytics connection settings are missing.');
			return startLogAnalyticsQuery(cluster.logAnalytics, query);
		case 'kusto':
			return startKustoQuery(database, query, cluster.url);
		case 'none':
			throw new Error('Queries are unavailable for this connection.');
	}
}

/** Releases a removed emulated connection and any browser resources it owns. */
export function releaseClusterRuntime(clusterId: string): Promise<void> {
	return enqueueTransition(() => disposeDuckDb(clusterId));
}

/** Releases all DuckDB workers when the application workspace is left. */
export function releaseAllClusterRuntimes(): Promise<void> {
	return enqueueTransition(() => disposeAllDuckDbSessions());
}
