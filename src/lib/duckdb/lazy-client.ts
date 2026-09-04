import { browser } from '$app/environment';
import type { DuckDbFileQueryOptions } from './query-client';
import type { QueryExecution } from '$lib/types/query-result';

export type { DuckDbFileQueryOptions, DuckDbRegisteredFileSource } from './query-client';

type DuckDbClient = typeof import('./query-client');

export type LazyDuckDbClientOptions = {
	isBrowser: boolean;
	importClient: () => Promise<DuckDbClient>;
};

/** Creates an isolated lazy runtime so import and disposal state has explicit ownership. */
export function createLazyDuckDbClient(options: LazyDuckDbClientOptions) {
	let clientPromise: Promise<DuckDbClient> | undefined;

	function loadClient() {
		if (!options.isBrowser) {
			return Promise.reject(new Error('DuckDB-WASM is available only in a browser.'));
		}

		clientPromise ??= options.importClient().catch((error: unknown) => {
			clientPromise = undefined;
			throw error;
		});
		return clientPromise;
	}

	return {
		executeDuckDbSql(...args: Parameters<DuckDbClient['executeDuckDbSql']>) {
			return loadClient().then((client) => client.executeDuckDbSql(...args));
		},
		executeDuckDbQuery(...args: Parameters<DuckDbClient['executeDuckDbQuery']>) {
			return loadClient().then((client) => client.executeDuckDbQuery(...args));
		},
		isPersistentDuckDbSession(...args: Parameters<DuckDbClient['isPersistentDuckDbSession']>) {
			return loadClient().then((client) => client.isPersistentDuckDbSession(...args));
		},
		getDuckDbInternalCatalogName(
			...args: Parameters<DuckDbClient['getDuckDbInternalCatalogName']>
		) {
			return loadClient().then((client) => client.getDuckDbInternalCatalogName(...args));
		},
		checkpointDuckDb(...args: Parameters<DuckDbClient['checkpointDuckDb']>) {
			return loadClient().then((client) => client.checkpointDuckDb(...args));
		},
		createDuckDbDatabase(...args: Parameters<DuckDbClient['createDuckDbDatabase']>) {
			return loadClient().then((client) => client.createDuckDbDatabase(...args));
		},
		dropDuckDbDatabase(...args: Parameters<DuckDbClient['dropDuckDbDatabase']>) {
			return loadClient().then((client) => client.dropDuckDbDatabase(...args));
		},
		/** Preserves the synchronous QueryExecution API while deferring the heavy import. */
		startDuckDbFileQuery(fileOptions: DuckDbFileQueryOptions): QueryExecution {
			let execution: QueryExecution | undefined;
			let cancelled = false;

			const promise = (async () => {
				const client = await loadClient();
				if (cancelled) throw new Error('Query cancelled.');
				execution = client.startDuckDbFileQuery(fileOptions);
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
		},
		/** Does not import DuckDB merely to dispose a runtime that was never created. */
		async disposeDuckDb(sessionId: string) {
			if (!clientPromise) return;
			return (await clientPromise).disposeDuckDb(sessionId);
		},
		async disposeInactiveDuckDbSessions(activeSessionId?: string) {
			if (!clientPromise) return;
			return (await clientPromise).disposeInactiveDuckDbSessions(activeSessionId);
		},
		async disposeAllDuckDbSessions() {
			if (!clientPromise) return;
			return (await clientPromise).disposeAllDuckDbSessions();
		}
	};
}

const defaultClient = createLazyDuckDbClient({
	isBrowser: browser,
	importClient: () => import('./query-client')
});

export const executeDuckDbSql = defaultClient.executeDuckDbSql;
export const executeDuckDbQuery = defaultClient.executeDuckDbQuery;
export const isPersistentDuckDbSession = defaultClient.isPersistentDuckDbSession;
export const getDuckDbInternalCatalogName = defaultClient.getDuckDbInternalCatalogName;
export const checkpointDuckDb = defaultClient.checkpointDuckDb;
export const createDuckDbDatabase = defaultClient.createDuckDbDatabase;
export const dropDuckDbDatabase = defaultClient.dropDuckDbDatabase;
export const startDuckDbFileQuery = defaultClient.startDuckDbFileQuery;
export const disposeDuckDb = defaultClient.disposeDuckDb;
export const disposeInactiveDuckDbSessions = defaultClient.disposeInactiveDuckDbSessions;
export const disposeAllDuckDbSessions = defaultClient.disposeAllDuckDbSessions;
