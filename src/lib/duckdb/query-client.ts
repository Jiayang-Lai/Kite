import * as duckdb from '@duckdb/duckdb-wasm';
import DUCKDB_BUNDLES from '#kite-duckdb-bundles';

import { getEmulatedStorage, type EmulatedStorage } from '$lib/emulation/storage';
import type { QueryExecution, QueryResult } from '$lib/types/query-result';
import {
	quoteDuckDbIdentifier,
	quoteDuckDbString,
	rewritePersistentDuckDbSql
} from './persistent-sql';
import { materializeDuckDbResult, type DuckDbQueryResult } from './result';
import { getPersistentDuckDbFilePrefix } from './storage';

export { deletePersistentDuckDbStorage, getPersistentDuckDbFilePrefix } from './storage';

type DuckDbSession = {
	sessionId: string;
	database: duckdb.AsyncDuckDB;
	connection: duckdb.AsyncDuckDBConnection;
	storage: EmulatedStorage;
	internalCatalogName?: string;
	persistentDatabases: Map<string, PersistentDatabase>;
	lockLease?: BrowserLockLease;
};

type PersistentDatabase = {
	id: string;
	name: string;
};

type BrowserLockLease = {
	release: () => Promise<void>;
};

export type DuckDbRegisteredFileSource =
	{ kind: 'text'; text: string } | { kind: 'file'; file: File } | { kind: 'url'; url: string };

export type DuckDbFileQueryOptions = {
	sessionId: string;
	source: DuckDbRegisteredFileSource;
	fileExtension: 'csv' | 'parquet';
	buildSql: (virtualPath: string) => string;
};

const PERSISTENCE_SCHEMA = 'kite_internal';
const PERSISTENCE_TABLE = 'databases';
const PERSISTENCE_WRITE_PROBE = '__kite_opfs_write_probe';
const sessionPromises = new Map<string, Promise<DuckDbSession>>();
let nextRequestId = 0;

function rewritePersistentSql(session: DuckDbSession, sql: string) {
	return rewritePersistentDuckDbSql(sql, session.storage.mode, session.internalCatalogName);
}

function getPersistentCatalogPath(storageId: string) {
	return `opfs://${getPersistentDuckDbFilePrefix(storageId)}catalog.duckdb`;
}

function getPersistentOpenConfig(storageId: string): duckdb.DuckDBConfig {
	return {
		path: getPersistentCatalogPath(storageId),
		accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
		opfs: { fileHandling: 'manual' }
	};
}

async function acquirePersistentClusterLock(storageId: string): Promise<BrowserLockLease> {
	if (typeof navigator === 'undefined' || !navigator.locks) {
		throw new Error('Persistent emulated clusters require browser Web Locks support.');
	}

	let releaseLock!: () => void;
	let resolveAcquired!: (acquired: boolean) => void;
	let released = false;
	const holdLock = new Promise<void>((resolve) => {
		releaseLock = resolve;
	});
	const acquired = new Promise<boolean>((resolve) => {
		resolveAcquired = resolve;
	});
	const lockRequest = navigator.locks
		.request(`kite:duckdb:${storageId}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
			resolveAcquired(Boolean(lock));
			if (lock) await holdLock;
		})
		.catch(() => {
			resolveAcquired(false);
		});

	if (!(await acquired)) {
		await lockRequest;
		throw new Error('This persistent emulated cluster is already open in another browser tab.');
	}

	return {
		async release() {
			if (released) return;
			released = true;
			releaseLock();
			await lockRequest;
		}
	};
}

function manifestTable(session: DuckDbSession) {
	if (!session.internalCatalogName)
		throw new Error('The persistent DuckDB catalog is unavailable.');
	return `${quoteDuckDbIdentifier(session.internalCatalogName)}.${quoteDuckDbIdentifier(
		PERSISTENCE_SCHEMA
	)}.${quoteDuckDbIdentifier(PERSISTENCE_TABLE)}`;
}

function rowString(row: unknown, field: string) {
	return String((row as Record<string, unknown>)[field]);
}

async function loadPersistentManifest(session: DuckDbSession) {
	const table = await session.connection.query(
		`SELECT database_id, logical_name FROM ${manifestTable(session)} ORDER BY logical_name`
	);
	return table.toArray().map((row) => ({
		id: rowString(row, 'database_id'),
		name: rowString(row, 'logical_name')
	}));
}

async function bootstrapPersistentSession(session: DuckDbSession) {
	if (session.storage.mode !== 'opfs') return;
	const catalogResult = await session.connection.query(
		'SELECT current_database() AS database_name'
	);
	const catalogRow = catalogResult.toArray()[0];
	if (!catalogRow) throw new Error('DuckDB did not expose its persistent catalog.');
	session.internalCatalogName = rowString(catalogRow, 'database_name');

	await session.connection.query(
		`CREATE SCHEMA IF NOT EXISTS ${quoteDuckDbIdentifier(PERSISTENCE_SCHEMA)};
		 CREATE TABLE IF NOT EXISTS ${quoteDuckDbIdentifier(PERSISTENCE_SCHEMA)}.${quoteDuckDbIdentifier(
				PERSISTENCE_TABLE
			)} (
			database_id VARCHAR PRIMARY KEY,
			logical_name VARCHAR UNIQUE NOT NULL
		 )`
	);
	await session.connection.query(
		`CREATE OR REPLACE TABLE ${quoteDuckDbIdentifier(PERSISTENCE_WRITE_PROBE)} AS SELECT 1 AS value;
		 DROP TABLE ${quoteDuckDbIdentifier(PERSISTENCE_WRITE_PROBE)}`
	);

	let databases = await loadPersistentManifest(session);
	if (!databases.some((database) => database.name.toLowerCase() === 'memory')) {
		const database: PersistentDatabase = {
			id: 'default',
			name: 'memory'
		};
		await session.connection.query(
			`INSERT INTO ${manifestTable(session)} VALUES (${quoteDuckDbString(database.id)}, ${quoteDuckDbString(
				database.name
			)})`
		);
		databases = [...databases, database];
	}

	for (const database of databases) {
		await session.connection.query(
			`CREATE SCHEMA IF NOT EXISTS ${quoteDuckDbIdentifier(database.name)}`
		);
		session.persistentDatabases.set(database.name.toLowerCase(), database);
	}
	await session.connection.query(`SET schema = ${quoteDuckDbString('memory')}`);
}

async function instantiateDuckDb(sessionId: string) {
	const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
	if (!bundle.mainWorker) throw new Error('DuckDB could not select a compatible browser worker.');

	// Vite's development server injects an ESM import into `?url` JavaScript assets.
	const worker = new Worker(bundle.mainWorker, {
		name: `kite-duckdb-${sessionId}`,
		type: 'module'
	});
	const database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
	try {
		await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
		return database;
	} catch (cause) {
		await database.terminate().catch(() => undefined);
		throw cause;
	}
}

async function createSession(sessionId: string): Promise<DuckDbSession> {
	const storage = getEmulatedStorage(sessionId);
	let lockLease: BrowserLockLease | undefined;
	let database: duckdb.AsyncDuckDB | undefined;
	let connection: duckdb.AsyncDuckDBConnection | undefined;

	try {
		if (storage.mode === 'opfs') {
			if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
				throw new Error('Persistent emulated clusters are not supported by this browser.');
			}
			lockLease = await acquirePersistentClusterLock(storage.storageId);
			void navigator.storage.persist?.().catch(() => false);
		}
		database = await instantiateDuckDb(sessionId);
		if (storage.mode === 'opfs') {
			await database.open(getPersistentOpenConfig(storage.storageId));
		}
		connection = await database.connect();
		const session: DuckDbSession = {
			sessionId,
			database,
			connection,
			storage,
			persistentDatabases: new Map(),
			lockLease
		};
		if (storage.mode === 'opfs') await bootstrapPersistentSession(session);
		return session;
	} catch (cause) {
		if (connection) await connection.close().catch(() => undefined);
		await database?.reset().catch(() => undefined);
		await database?.terminate().catch(() => undefined);
		await lockLease?.release().catch(() => undefined);
		throw cause;
	}
}

function getSession(sessionId: string) {
	const existing = sessionPromises.get(sessionId);
	if (existing) return existing;

	const sessionPromise = createSession(sessionId).catch((cause) => {
		sessionPromises.delete(sessionId);
		throw cause;
	});
	sessionPromises.set(sessionId, sessionPromise);
	return sessionPromise;
}

/** Returns whether one DuckDB session writes its databases to browser OPFS. */
export async function isPersistentDuckDbSession(sessionId: string) {
	return (await getSession(sessionId)).storage.mode === 'opfs';
}

/** Returns the internal manifest catalog that must be hidden from the Kite database explorer. */
export async function getDuckDbInternalCatalogName(sessionId: string) {
	return (await getSession(sessionId)).internalCatalogName;
}

/** Flushes persistent logical databases and their private manifest into the cluster's OPFS file. */
export async function checkpointDuckDb(sessionId: string) {
	await checkpointDuckDbSession(await getSession(sessionId));
}

/** Creates an attached memory database or a persistent logical schema according to its session. */
export async function createDuckDbDatabase(sessionId: string, name: string) {
	const session = await getSession(sessionId);
	if (session.storage.mode !== 'opfs') {
		await session.connection.query(`ATTACH ':memory:' AS ${quoteDuckDbIdentifier(name)}`);
		return;
	}

	const databaseId =
		globalThis.crypto?.randomUUID?.() ??
		`database-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const database: PersistentDatabase = {
		id: databaseId,
		name
	};

	try {
		await session.connection.query(`CREATE SCHEMA ${quoteDuckDbIdentifier(database.name)}`);
		await session.connection.query(
			`INSERT INTO ${manifestTable(session)} VALUES (${quoteDuckDbString(database.id)}, ${quoteDuckDbString(
				database.name
			)})`
		);
	} catch (cause) {
		await session.connection
			.query(`DROP SCHEMA IF EXISTS ${quoteDuckDbIdentifier(database.name)} CASCADE`)
			.catch(() => undefined);
		throw cause;
	}
	session.persistentDatabases.set(database.name.toLowerCase(), database);
	await checkpointDuckDbSession(session);
}

/** Removes an attached memory database or persistent logical schema. */
export async function dropDuckDbDatabase(sessionId: string, name: string, fallbackName: string) {
	const session = await getSession(sessionId);
	if (session.storage.mode !== 'opfs') {
		await session.connection.query(
			`USE ${quoteDuckDbIdentifier(fallbackName)}; DETACH ${quoteDuckDbIdentifier(name)}`
		);
		return;
	}

	const database = session.persistentDatabases.get(name.toLowerCase());
	if (!database) throw new Error(`Persistent database “${name}” is not registered.`);

	await session.connection.query(
		`SET schema = ${quoteDuckDbString(fallbackName)};
		 DROP SCHEMA ${quoteDuckDbIdentifier(name)} CASCADE`
	);
	await session.connection.query(
		`DELETE FROM ${manifestTable(session)} WHERE database_id = ${quoteDuckDbString(database.id)}`
	);
	session.persistentDatabases.delete(name.toLowerCase());
	await checkpointDuckDbSession(session);
}

/** Executes SQL against one emulated cluster's DuckDB session. */
export async function executeDuckDbSql(sql: string, sessionId: string): Promise<DuckDbQueryResult> {
	const session = await getSession(sessionId);
	const startedAt = performance.now();
	const table = await session.connection.query(rewritePersistentSql(session, sql));
	return materializeDuckDbResult(table, performance.now() - startedAt);
}

/** Executes SQL and adapts the response for Kite's query result renderer. */
export async function executeDuckDbQuery(sql: string, sessionId: string): Promise<QueryResult> {
	const clientRequestId = `duckdb-${++nextRequestId}`;
	const result = await executeDuckDbSql(sql, sessionId);

	return {
		columns: result.columns,
		rows: result.rows,
		totalRowCount: result.rows.length,
		renderedRowCount: result.rows.length,
		warnings: [],
		elapsedMs: result.elapsedMs,
		clientRequestId
	};
}

/**
 * Runs one transaction against a temporary browser or HTTP file.
 * A dedicated connection makes cancellation local to this ingestion operation.
 */
export function startDuckDbFileQuery(options: DuckDbFileQueryOptions): QueryExecution {
	const clientRequestId = `duckdb-ingest-${++nextRequestId}`;
	const virtualPath = `kite-ingest-${crypto.randomUUID()}.${options.fileExtension}`;
	let connection: duckdb.AsyncDuckDBConnection | undefined;
	let cancelled = false;

	const promise = (async (): Promise<QueryResult> => {
		const { database } = await getSession(options.sessionId);
		if (cancelled) throw new Error('Query cancelled.');

		connection = await database.connect();
		let registered = false;
		let transactionOpen = false;
		let committed = false;
		try {
			if (options.source.kind === 'text') {
				await database.registerFileText(virtualPath, options.source.text);
			} else if (options.source.kind === 'file') {
				await database.registerFileHandle(
					virtualPath,
					options.source.file,
					duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
					true
				);
			} else {
				await database.registerFileURL(
					virtualPath,
					options.source.url,
					duckdb.DuckDBDataProtocol.HTTP,
					false
				);
			}
			registered = true;
			if (cancelled) throw new Error('Query cancelled.');

			await connection.query('BEGIN TRANSACTION');
			transactionOpen = true;
			const startedAt = performance.now();
			const table = await connection.query(
				rewritePersistentSql(await getSession(options.sessionId), options.buildSql(virtualPath))
			);
			const elapsedMs = performance.now() - startedAt;
			if (cancelled) throw new Error('Query cancelled.');
			await connection.query('COMMIT');
			transactionOpen = false;
			committed = true;

			const result = materializeDuckDbResult(table, elapsedMs);
			return {
				...result,
				totalRowCount: result.rows.length,
				renderedRowCount: result.rows.length,
				warnings: [],
				clientRequestId
			};
		} catch (cause) {
			if (transactionOpen) {
				try {
					await connection.query('ROLLBACK');
				} catch {
					// Preserve the original ingestion or cancellation error.
				}
			}
			if (cancelled) throw new Error('Query cancelled.');
			throw cause;
		} finally {
			if (registered) {
				try {
					await database.dropFile(virtualPath);
				} catch {
					// The worker also releases registered files when its session is disposed.
				}
			}
			await connection.close();
			connection = undefined;
			if (committed) await checkpointDuckDb(options.sessionId);
		}
	})();

	return {
		promise,
		cancel() {
			cancelled = true;
			if (connection) void connection.cancelSent();
		}
	};
}

/** Releases one DuckDB connection, its WASM memory, and its worker. */
export async function disposeDuckDb(sessionId: string): Promise<void> {
	const activeSession = sessionPromises.get(sessionId);
	sessionPromises.delete(sessionId);
	if (!activeSession) return;

	let session: DuckDbSession | undefined;
	try {
		session = await activeSession;
		if (session.storage.mode === 'opfs') {
			try {
				await checkpointDuckDbSession(session, false);
			} catch {
				// DuckDB can still recover from its WAL if a final checkpoint fails.
				await session.connection.close().catch(() => undefined);
				await session.database.reset().catch(() => undefined);
				await session.database.dropFiles().catch(() => undefined);
			}
		} else {
			await session.connection.close().catch(() => undefined);
			await session.database.reset().catch(() => undefined);
			await session.database.dropFiles().catch(() => undefined);
		}
		await session.database.terminate().catch(() => undefined);
	} catch {
		// A failed initialization has already terminated its worker.
	} finally {
		await session?.lockLease?.release().catch(() => undefined);
	}
}

/** Releases every initialized DuckDB session except the session that is becoming active. */
export async function disposeInactiveDuckDbSessions(activeSessionId?: string): Promise<void> {
	const inactiveSessionIds = Array.from(sessionPromises.keys()).filter(
		(sessionId) => sessionId !== activeSessionId
	);
	await Promise.all(inactiveSessionIds.map((sessionId) => disposeDuckDb(sessionId)));
}

/** Releases every initialized DuckDB session owned by this browser page. */
export async function disposeAllDuckDbSessions(): Promise<void> {
	await disposeInactiveDuckDbSessions();
}

/**
 * Commits OPFS writes by terminating the worker, which closes every synchronous
 * access handle. DuckDB-WASM's public flush/drop APIs cannot close unused prepared
 * WAL handles, so mutations pay the cost of restarting; ordinary queries do not.
 */
async function checkpointDuckDbSession(session: DuckDbSession, reopen = true) {
	if (session.storage.mode !== 'opfs') return;
	if (!session.internalCatalogName) return;

	const currentResult = await session.connection.query('SELECT current_schema() AS database_name');
	const currentRow = currentResult.toArray()[0];
	const currentDatabase = currentRow ? rowString(currentRow, 'database_name') : 'memory';
	await session.connection.query(
		`CHECKPOINT ${quoteDuckDbIdentifier(session.internalCatalogName)}`
	);
	await session.connection.close();
	await session.database.reset();
	await session.database.terminate();
	if (!reopen) return;

	session.persistentDatabases.clear();
	session.internalCatalogName = undefined;
	session.database = await instantiateDuckDb(session.sessionId);
	await session.database.open(getPersistentOpenConfig(session.storage.storageId));
	session.connection = await session.database.connect();
	await bootstrapPersistentSession(session);

	const restoreDatabase = session.persistentDatabases.has(currentDatabase.toLowerCase())
		? currentDatabase
		: 'memory';
	await session.connection.query(`SET schema = ${quoteDuckDbString(restoreDatabase)}`);
}
