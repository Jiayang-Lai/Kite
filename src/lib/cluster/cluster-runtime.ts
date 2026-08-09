import {
	disposeAllDuckDbSessions,
	disposeDuckDb,
	disposeInactiveDuckDbSessions
} from '$lib/duckdb/lazy-client';
import { loadEmulatedSchema } from '$lib/emulation/cluster';
import { registerEmulatedStorage } from '$lib/emulation/storage';
import { loadBackendSchema } from '$lib/kusto/backend-schema';
import { loadLogAnalyticsSchema } from '$lib/log-analytics/client';
import type { KustoClusterConnection } from '$lib/kusto/query-client';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
import { getMockClusterSchema } from './mock-cluster-schema';

let transitionQueue = Promise.resolve();

function enqueueTransition<T>(transition: () => Promise<T>): Promise<T> {
	const result = transitionQueue.then(transition, transition);
	transitionQueue = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}

/**
 * Loads one cluster schema while enforcing a single live DuckDB session.
 *
 * Remote connections are validated before the previous emulated session is
 * released. Emulated connections release inactive workers first so their WASM
 * allocations never overlap.
 */
export function connectClusterRuntime(
	cluster: KustoClusterConnection
): Promise<KustoDatabaseSchema> {
	return enqueueTransition(async () => {
		if (cluster.kind === 'emulated') {
			registerEmulatedStorage(cluster.id, cluster.emulatedStorage);
			await disposeInactiveDuckDbSessions(cluster.id);
			return loadEmulatedSchema(cluster.id);
		}
		if (cluster.kind === 'log-analytics') {
			if (!cluster.logAnalytics) throw new Error('Log Analytics connection settings are missing.');
			const schema = await loadLogAnalyticsSchema(cluster.logAnalytics, cluster.name);
			await disposeInactiveDuckDbSessions();
			return schema;
		}

		const schema =
			cluster.kind === 'mock'
				? getMockClusterSchema(cluster)
				: await loadBackendSchema(cluster.url);
		await disposeInactiveDuckDbSessions();
		return schema;
	});
}

/** Releases a removed emulated connection and any browser resources it owns. */
export function releaseClusterRuntime(clusterId: string): Promise<void> {
	return enqueueTransition(() => disposeDuckDb(clusterId));
}

/** Releases all DuckDB workers when the application workspace is left. */
export function releaseAllClusterRuntimes(): Promise<void> {
	return enqueueTransition(() => disposeAllDuckDbSessions());
}
