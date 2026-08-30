import { releaseClusterRuntime } from '$lib/cluster/cluster-runtime';
import { deletePersistentDuckDbStorage } from '$lib/duckdb/storage';
import type { KustoClusterConnection } from '$lib/kusto/query-client';

const STORAGE_KEY = 'kite:pending-emulated-cluster-cleanup:v1';

export type RemovedClusterCleanup = {
	clusterId: string;
	storageId?: string;
};

function readPendingCleanups(): RemovedClusterCleanup[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((value) => {
			if (!value || typeof value !== 'object') return [];
			const cleanup = value as Record<string, unknown>;
			if (typeof cleanup.clusterId !== 'string' || !cleanup.clusterId) return [];
			return [
				{
					clusterId: cleanup.clusterId,
					storageId:
						typeof cleanup.storageId === 'string' && cleanup.storageId
							? cleanup.storageId
							: undefined
				}
			];
		});
	} catch {
		return [];
	}
}

function writePendingCleanups(cleanups: RemovedClusterCleanup[]) {
	if (typeof localStorage === 'undefined') return;
	try {
		if (cleanups.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanups));
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		throw new Error('Connection removal could not be prepared in browser storage.');
	}
}

/** Records cleanup before the connection catalog removal is committed. */
export function stageRemovedClusterCleanup(
	cluster: KustoClusterConnection
): RemovedClusterCleanup | undefined {
	if (cluster.kind !== 'emulated') return undefined;
	const cleanup: RemovedClusterCleanup = {
		clusterId: cluster.id,
		storageId:
			cluster.emulatedStorage?.mode === 'opfs' ? cluster.emulatedStorage.storageId : undefined
	};
	const pending = readPendingCleanups().filter((item) => item.clusterId !== cluster.id);
	writePendingCleanups([...pending, cleanup]);
	return cleanup;
}

export function discardRemovedClusterCleanup(clusterId: string) {
	writePendingCleanups(readPendingCleanups().filter((item) => item.clusterId !== clusterId));
}

/** Attempts every destructive step, preserving the first error when more than one fails. */
export async function runRemovedClusterCleanup(cleanup: RemovedClusterCleanup) {
	let cleanupError: unknown;
	try {
		await releaseClusterRuntime(cleanup.clusterId);
	} catch (error) {
		cleanupError = error;
	}

	if (cleanup.storageId) {
		try {
			await deletePersistentDuckDbStorage(cleanup.storageId);
		} catch (error) {
			cleanupError ??= error;
		}
	}

	if (cleanupError) throw cleanupError;
}

/** Retries cleanup left by an earlier committed removal. */
export async function retryRemovedClusterCleanups(existingClusterIds: ReadonlySet<string>) {
	for (const cleanup of readPendingCleanups()) {
		try {
			// A staged cleanup can survive a failed catalog write or a page interruption. Never clean
			// resources while their connection still exists.
			if (existingClusterIds.has(cleanup.clusterId)) {
				discardRemovedClusterCleanup(cleanup.clusterId);
				continue;
			}
			await runRemovedClusterCleanup(cleanup);
			discardRemovedClusterCleanup(cleanup.clusterId);
		} catch (error) {
			console.error(`Cleanup for removed connection ${cleanup.clusterId} failed.`, error);
		}
	}
}
