import type { DuckDbFileQueryOptions } from './query-client';
import type { QueryExecution } from '$lib/types/query-result';

export type { DuckDbFileQueryOptions, DuckDbRegisteredFileSource } from './query-client';

type DuckDbClient = typeof import('./query-client');

let clientPromise: Promise<DuckDbClient> | undefined;

function loadClient() {
	clientPromise ??= import('./query-client').catch((error: unknown) => {
		clientPromise = undefined;
		throw error;
	});
	return clientPromise;
}

export async function executeDuckDbSql(...args: Parameters<DuckDbClient['executeDuckDbSql']>) {
	return (await loadClient()).executeDuckDbSql(...args);
}

export async function executeDuckDbQuery(...args: Parameters<DuckDbClient['executeDuckDbQuery']>) {
	return (await loadClient()).executeDuckDbQuery(...args);
}

export async function isPersistentDuckDbSession(
	...args: Parameters<DuckDbClient['isPersistentDuckDbSession']>
) {
	return (await loadClient()).isPersistentDuckDbSession(...args);
}

export async function getDuckDbInternalCatalogName(
	...args: Parameters<DuckDbClient['getDuckDbInternalCatalogName']>
) {
	return (await loadClient()).getDuckDbInternalCatalogName(...args);
}

export async function checkpointDuckDb(...args: Parameters<DuckDbClient['checkpointDuckDb']>) {
	return (await loadClient()).checkpointDuckDb(...args);
}

export async function createDuckDbDatabase(
	...args: Parameters<DuckDbClient['createDuckDbDatabase']>
) {
	return (await loadClient()).createDuckDbDatabase(...args);
}

export async function dropDuckDbDatabase(...args: Parameters<DuckDbClient['dropDuckDbDatabase']>) {
	return (await loadClient()).dropDuckDbDatabase(...args);
}

/**
 * Preserves DuckDB's synchronous QueryExecution API while deferring the heavy
 * client import until the first emulated ingestion actually starts.
 */
export function startDuckDbFileQuery(options: DuckDbFileQueryOptions): QueryExecution {
	let execution: QueryExecution | undefined;
	let cancelled = false;

	const promise = (async () => {
		const client = await loadClient();
		if (cancelled) throw new Error('Query cancelled.');

		execution = client.startDuckDbFileQuery(options);
		if (cancelled) execution.cancel();
		return execution.promise;
	})();

	return {
		promise,
		cancel() {
			cancelled = true;
			execution?.cancel();
		}
	};
}

/** Do not import DuckDB merely to dispose a runtime that was never created. */
export async function disposeDuckDb(sessionId?: string) {
	if (!clientPromise) return;
	return (await clientPromise).disposeDuckDb(sessionId);
}

export async function disposeInactiveDuckDbSessions(activeSessionId?: string) {
	if (!clientPromise) return;
	return (await clientPromise).disposeInactiveDuckDbSessions(activeSessionId);
}

export async function disposeAllDuckDbSessions() {
	if (!clientPromise) return;
	return (await clientPromise).disposeAllDuckDbSessions();
}
