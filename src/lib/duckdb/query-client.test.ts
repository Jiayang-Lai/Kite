import { beforeEach, describe, expect, it, vi } from 'vitest';

const duckDbMocks = vi.hoisted(() => {
	const connection = {
		query: vi.fn(),
		close: vi.fn(),
		cancelSent: vi.fn()
	};
	const database = {
		instantiate: vi.fn(),
		connect: vi.fn(),
		terminate: vi.fn(),
		registerFileText: vi.fn(),
		dropFile: vi.fn()
	};
	return {
		connection,
		database,
		selectBundle: vi.fn(),
		AsyncDuckDB: vi.fn(function () {
			return database;
		}),
		materializeDuckDbResult: vi.fn()
	};
});

vi.mock('@duckdb/duckdb-wasm', () => ({
	selectBundle: duckDbMocks.selectBundle,
	AsyncDuckDB: duckDbMocks.AsyncDuckDB,
	VoidLogger: class {},
	DuckDBAccessMode: { READ_WRITE: 2 },
	DuckDBDataProtocol: { BROWSER_FILEREADER: 1, HTTP: 2 }
}));
vi.mock('#kite-duckdb-bundles', () => ({ default: {} }));
vi.mock('$lib/emulation/storage', () => ({
	getEmulatedStorage: () => ({ mode: 'memory' })
}));
vi.mock('./result', () => ({
	materializeDuckDbResult: duckDbMocks.materializeDuckDbResult
}));

import { OperationCancelledError } from '$lib/types/query-result';
import { executeDuckDbSql, startDuckDbFileQuery } from './query-client';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('Worker', class {});
	duckDbMocks.selectBundle.mockResolvedValue({ mainWorker: '/duckdb.worker.js', mainModule: {} });
	duckDbMocks.database.instantiate.mockResolvedValue(undefined);
	duckDbMocks.database.connect.mockResolvedValue(duckDbMocks.connection);
	duckDbMocks.database.terminate.mockResolvedValue(undefined);
	duckDbMocks.materializeDuckDbResult.mockReturnValue({ columns: [], rows: [] });
	duckDbMocks.database.registerFileText.mockResolvedValue(undefined);
	duckDbMocks.database.dropFile.mockResolvedValue(undefined);
	duckDbMocks.connection.close.mockResolvedValue(undefined);
	duckDbMocks.connection.cancelSent.mockResolvedValue(true);
});

describe('DuckDB SQL cancellation', () => {
	it('terminates a stalled session and creates a fresh session for the next query', async () => {
		duckDbMocks.connection.query.mockReturnValueOnce(
			new Promise(() => {
				// Simulate a DuckDB worker request that never returns or rejects.
			})
		);
		const signal = Object.assign(new EventTarget(), {
			aborted: false,
			reason: undefined
		}) as unknown as AbortSignal;

		const first = executeDuckDbSql('SELECT 1', 'emulated-1', signal);
		await vi.waitFor(() => expect(duckDbMocks.connection.query).toHaveBeenCalledOnce());
		Object.defineProperty(signal, 'aborted', { value: true });
		signal.dispatchEvent(new Event('abort'));

		await expect(first).rejects.toMatchObject({ name: 'AbortError' });
		expect(duckDbMocks.database.terminate).toHaveBeenCalledOnce();

		duckDbMocks.connection.query.mockResolvedValueOnce({});
		await expect(executeDuckDbSql('SELECT 2', 'emulated-1')).resolves.toEqual({
			columns: [],
			rows: []
		});
		expect(duckDbMocks.AsyncDuckDB).toHaveBeenCalledTimes(2);
	});

	it('cancels while a session is initializing and disposes the late session', async () => {
		const bundle = deferred<{ mainWorker: string; mainModule: object }>();
		duckDbMocks.selectBundle.mockReturnValueOnce(bundle.promise);
		const controller = new AbortController();

		const query = executeDuckDbSql('SELECT 1', 'emulated-initializing', controller.signal);
		controller.abort();
		await expect(query).rejects.toMatchObject({ name: 'AbortError' });

		bundle.resolve({ mainWorker: '/duckdb.worker.js', mainModule: {} });
		await vi.waitFor(() => expect(duckDbMocks.database.terminate).toHaveBeenCalledOnce());

		duckDbMocks.connection.query.mockResolvedValueOnce({});
		await expect(executeDuckDbSql('SELECT 2', 'emulated-initializing')).resolves.toEqual({
			columns: [],
			rows: []
		});
		expect(duckDbMocks.AsyncDuckDB).toHaveBeenCalledTimes(2);
	});

	it('preserves query failures and supplies a default abort error', async () => {
		const failure = new Error('Catalog query failed.');
		duckDbMocks.connection.query.mockRejectedValueOnce(failure);

		await expect(executeDuckDbSql('SELECT 1', 'emulated-errors')).rejects.toBe(failure);
		await expect(
			executeDuckDbSql('SELECT 2', 'emulated-errors', {
				aborted: true,
				reason: undefined
			} as AbortSignal)
		).rejects.toMatchObject({ name: 'AbortError' });
	});
});

describe('DuckDB file ingestion cancellation', () => {
	function startTextIngestion(sessionId: string) {
		return startDuckDbFileQuery({
			sessionId,
			source: { kind: 'text', text: 'a,b\n' },
			fileExtension: 'csv',
			buildSql: (path) => `INSERT INTO Events SELECT * FROM read_csv('${path}')`
		});
	}

	it('stops before connecting when cancelled while the session starts', async () => {
		const execution = startTextIngestion('ingest-before-connect');
		execution.cancel();

		await expect(execution.promise).rejects.toBeInstanceOf(OperationCancelledError);
		expect(duckDbMocks.database.registerFileText).not.toHaveBeenCalled();
	});

	it('drops the registered file when cancelled during registration', async () => {
		const registration = deferred<undefined>();
		duckDbMocks.database.registerFileText.mockReturnValueOnce(registration.promise);
		const execution = startTextIngestion('ingest-registering');
		await vi.waitFor(() => expect(duckDbMocks.database.registerFileText).toHaveBeenCalledOnce());

		execution.cancel();
		expect(duckDbMocks.connection.cancelSent).toHaveBeenCalledOnce();
		registration.resolve(undefined);

		await expect(execution.promise).rejects.toBeInstanceOf(OperationCancelledError);
		expect(duckDbMocks.connection.query).not.toHaveBeenCalledWith('BEGIN TRANSACTION');
		expect(duckDbMocks.database.dropFile).toHaveBeenCalledOnce();
		expect(duckDbMocks.connection.close).toHaveBeenCalled();
	});

	it('rolls back an insert that finishes after cancellation', async () => {
		const insert = deferred<object>();
		duckDbMocks.connection.query.mockImplementation((sql: string) =>
			sql.startsWith('INSERT') ? insert.promise : Promise.resolve({})
		);
		const execution = startTextIngestion('ingest-inserting');
		await vi.waitFor(() =>
			expect(duckDbMocks.connection.query).toHaveBeenCalledWith(
				expect.stringContaining('INSERT INTO Events')
			)
		);

		execution.cancel();
		insert.resolve({});

		await expect(execution.promise).rejects.toBeInstanceOf(OperationCancelledError);
		expect(duckDbMocks.connection.query).toHaveBeenCalledWith('ROLLBACK');
		expect(duckDbMocks.connection.query).not.toHaveBeenCalledWith('COMMIT');
	});

	it('reports cancellation rather than the error of an interrupted insert', async () => {
		let rejectInsert!: (reason: unknown) => void;
		const interrupted = new Promise<object>((_resolve, reject) => (rejectInsert = reject));
		duckDbMocks.connection.query.mockImplementation((sql: string) =>
			sql.startsWith('INSERT') ? interrupted : Promise.resolve({})
		);
		const execution = startTextIngestion('ingest-interrupted');
		await vi.waitFor(() =>
			expect(duckDbMocks.connection.query).toHaveBeenCalledWith(
				expect.stringContaining('INSERT INTO Events')
			)
		);

		execution.cancel();
		rejectInsert(new Error('INTERRUPT'));

		await expect(execution.promise).rejects.toBeInstanceOf(OperationCancelledError);
		expect(duckDbMocks.connection.query).toHaveBeenCalledWith('ROLLBACK');
	});
});
