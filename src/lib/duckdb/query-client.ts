import * as duckdb from '@duckdb/duckdb-wasm';
import duckdbEhWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdbEhWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import duckdbMvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdbMvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

import { getEmulatedStorage, type EmulatedStorage } from '$lib/emulated/storage';
import type { DuckDbCatalogDatabase, DuckDbCatalogSchema, DuckDbQueryResult } from './types';
import type { QueryExecution, QueryResult } from '$lib/types/query-result';
import { getPersistentDuckDbFilePrefix } from './storage';

export { deletePersistentDuckDbStorage, getPersistentDuckDbFilePrefix } from './storage';

const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
	mvp: {
		mainModule: duckdbMvpWasm,
		mainWorker: duckdbMvpWorker
	},
	eh: {
		mainModule: duckdbEhWasm,
		mainWorker: duckdbEhWorker
	}
};

const CATALOG_SQL = `
	SELECT
		d.database_name,
		d.database_name = current_database() AS is_current,
		t.table_schema,
		t.table_name
	FROM duckdb_databases() AS d
	LEFT JOIN information_schema.tables AS t
		ON t.table_catalog = d.database_name
		AND t.table_type = 'BASE TABLE'
		AND t.table_schema NOT IN ('information_schema', 'pg_catalog')
	WHERE NOT d.internal
	ORDER BY d.database_name, t.table_schema, t.table_name
`;

const PERSISTENT_CATALOG_SQL = `
	SELECT
		s.schema_name AS database_name,
		s.schema_name = current_schema() AS is_current,
		'main' AS table_schema,
		t.table_name
	FROM information_schema.schemata AS s
	LEFT JOIN information_schema.tables AS t
		ON t.table_catalog = current_database()
		AND t.table_schema = s.schema_name
		AND t.table_type = 'BASE TABLE'
	WHERE s.catalog_name = current_database()
		AND s.schema_name NOT IN (
			'information_schema',
			'pg_catalog',
			'main',
			'kite_internal'
		)
	ORDER BY s.schema_name, t.table_name
`;

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

const DEFAULT_SESSION_ID = 'kql-to-sql-lab';
const PERSISTENCE_SCHEMA = 'kite_internal';
const PERSISTENCE_TABLE = 'databases';
const PERSISTENCE_WRITE_PROBE = '__kite_opfs_write_probe';
const sessionPromises = new Map<string, Promise<DuckDbSession>>();
let nextRequestId = 0;

function quoteIdentifier(value: string) {
	return `"${value.replaceAll('"', '""')}"`;
}

function quoteString(value: string) {
	return `'${value.replaceAll("'", "''")}'`;
}

function rewritePersistentSql(session: DuckDbSession, sql: string) {
	if (session.storage.mode !== 'opfs' || !session.internalCatalogName) return sql;

	const withSelectedSchema = sql.replace(
		/(^|;)\s*USE\s+"((?:[^"]|"")*)"\s*;?/gim,
		(_match, prefix: string, encodedName: string) =>
			`${prefix}\nSET schema = ${quoteString(encodedName.replaceAll('""', '"'))};`
	);

	return withSelectedSchema.replace(
		/("(?:[^"]|"")*")\s*\.\s*(?:"main"|main)\s*\.\s*("(?:[^"]|"")*")/gi,
		`${quoteIdentifier(session.internalCatalogName)}.$1.$2`
	);
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
	return `${quoteIdentifier(session.internalCatalogName)}.${quoteIdentifier(
		PERSISTENCE_SCHEMA
	)}.${quoteIdentifier(PERSISTENCE_TABLE)}`;
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
		`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(PERSISTENCE_SCHEMA)};
		 CREATE TABLE IF NOT EXISTS ${quoteIdentifier(PERSISTENCE_SCHEMA)}.${quoteIdentifier(
				PERSISTENCE_TABLE
			)} (
			database_id VARCHAR PRIMARY KEY,
			logical_name VARCHAR UNIQUE NOT NULL
		 )`
	);
	await session.connection.query(
		`CREATE OR REPLACE TABLE ${quoteIdentifier(PERSISTENCE_WRITE_PROBE)} AS SELECT 1 AS value;
		 DROP TABLE ${quoteIdentifier(PERSISTENCE_WRITE_PROBE)}`
	);

	let databases = await loadPersistentManifest(session);
	if (!databases.some((database) => database.name.toLowerCase() === 'memory')) {
		const database: PersistentDatabase = {
			id: 'default',
			name: 'memory'
		};
		await session.connection.query(
			`INSERT INTO ${manifestTable(session)} VALUES (${quoteString(database.id)}, ${quoteString(
				database.name
			)})`
		);
		databases = [...databases, database];
	}

	for (const database of databases) {
		await session.connection.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(database.name)}`);
		session.persistentDatabases.set(database.name.toLowerCase(), database);
	}
	await session.connection.query(`SET schema = ${quoteString('memory')}`);
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

function getSession(sessionId = DEFAULT_SESSION_ID) {
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
		await session.connection.query(`ATTACH ':memory:' AS ${quoteIdentifier(name)}`);
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
		await session.connection.query(`CREATE SCHEMA ${quoteIdentifier(database.name)}`);
		await session.connection.query(
			`INSERT INTO ${manifestTable(session)} VALUES (${quoteString(database.id)}, ${quoteString(
				database.name
			)})`
		);
	} catch (cause) {
		await session.connection
			.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(database.name)} CASCADE`)
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
			`USE ${quoteIdentifier(fallbackName)}; DETACH ${quoteIdentifier(name)}`
		);
		return;
	}

	const database = session.persistentDatabases.get(name.toLowerCase());
	if (!database) throw new Error(`Persistent database “${name}” is not registered.`);

	await session.connection.query(
		`SET schema = ${quoteString(fallbackName)};
		 DROP SCHEMA ${quoteIdentifier(name)} CASCADE`
	);
	await session.connection.query(
		`DELETE FROM ${manifestTable(session)} WHERE database_id = ${quoteString(database.id)}`
	);
	session.persistentDatabases.delete(name.toLowerCase());
	await checkpointDuckDbSession(session);
}

function normalizeValue(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'bigint') return value.toString();
	if (value instanceof Uint8Array) return Array.from(value);
	if (Array.isArray(value)) return value.map(normalizeValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, item]) => [
				key,
				normalizeValue(item)
			])
		);
	}
	return value;
}

function materializeResult(
	table: {
		schema: { fields: readonly { name: string; type: { toString(): string } }[] };
		toArray(): readonly unknown[];
	},
	elapsedMs: number
): DuckDbQueryResult {
	const columns = table.schema.fields.map((field) => ({
		name: field.name,
		type: field.type.toString()
	}));

	return {
		columns,
		rows: table
			.toArray()
			.map((row) =>
				columns.map((column) =>
					normalizeValue((row as unknown as Record<string, unknown>)[column.name])
				)
			),
		elapsedMs
	};
}

/** Executes SQL against the validation page's in-memory DuckDB database. */
export async function executeDuckDbSql(
	sql: string,
	sessionId = DEFAULT_SESSION_ID
): Promise<DuckDbQueryResult> {
	const session = await getSession(sessionId);
	const startedAt = performance.now();
	const table = await session.connection.query(rewritePersistentSql(session, sql));
	return materializeResult(table, performance.now() - startedAt);
}

/** Executes SQL and adapts the response for Kite's shared result drawer. */
export async function executeDuckDbQuery(
	sql: string,
	sessionId = DEFAULT_SESSION_ID
): Promise<QueryResult> {
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

			const result = materializeResult(table, elapsedMs);
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

/** Reads the attached databases and user tables visible to the in-memory DuckDB instance. */
export async function getDuckDbCatalog(
	sessionId = DEFAULT_SESSION_ID
): Promise<DuckDbCatalogDatabase[]> {
	const persistent = await isPersistentDuckDbSession(sessionId);
	const result = await executeDuckDbSql(
		persistent ? PERSISTENT_CATALOG_SQL : CATALOG_SQL,
		sessionId
	);
	const internalCatalogName = await getDuckDbInternalCatalogName(sessionId);
	const columnIndexes = Object.fromEntries(
		result.columns.map((column, index) => [column.name, index])
	);
	const databases = new Map<
		string,
		{ database: DuckDbCatalogDatabase; schemas: Map<string, DuckDbCatalogSchema> }
	>();

	for (const row of result.rows) {
		const databaseName = String(row[columnIndexes.database_name]);
		if (databaseName === internalCatalogName) continue;
		let entry = databases.get(databaseName);
		if (!entry) {
			entry = {
				database: {
					name: databaseName,
					isCurrent: Boolean(row[columnIndexes.is_current]),
					schemas: []
				},
				schemas: new Map()
			};
			databases.set(databaseName, entry);
		}

		const schemaValue = row[columnIndexes.table_schema];
		const tableValue = row[columnIndexes.table_name];
		if (schemaValue == null || tableValue == null) continue;

		const schemaName = String(schemaValue);
		let schema = entry.schemas.get(schemaName);
		if (!schema) {
			schema = { name: schemaName, tables: [] };
			entry.schemas.set(schemaName, schema);
			entry.database.schemas.push(schema);
		}
		schema.tables.push(String(tableValue));
	}

	return Array.from(databases.values(), ({ database }) => database);
}

/** Releases one DuckDB connection, its WASM memory, and its worker. */
export async function disposeDuckDb(sessionId = DEFAULT_SESSION_ID): Promise<void> {
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
	await session.connection.query(`CHECKPOINT ${quoteIdentifier(session.internalCatalogName)}`);
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
	await session.connection.query(`SET schema = ${quoteString(restoreDatabase)}`);
}
