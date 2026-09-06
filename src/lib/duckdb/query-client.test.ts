import { beforeEach, describe, expect, it, vi } from 'vitest';

const duckDbMocks = vi.hoisted(() => {
	const connection = {
		query: vi.fn(),
		close: vi.fn()
	};
	const database = {
		instantiate: vi.fn(),
		connect: vi.fn(),
		terminate: vi.fn()
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

import { executeDuckDbSql } from './query-client';

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('Worker', class {});
	duckDbMocks.selectBundle.mockResolvedValue({ mainWorker: '/duckdb.worker.js', mainModule: {} });
	duckDbMocks.database.instantiate.mockResolvedValue(undefined);
	duckDbMocks.database.connect.mockResolvedValue(duckDbMocks.connection);
	duckDbMocks.database.terminate.mockResolvedValue(undefined);
	duckDbMocks.materializeDuckDbResult.mockReturnValue({ columns: [], rows: [] });
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
