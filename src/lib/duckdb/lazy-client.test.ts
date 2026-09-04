import { describe, expect, it, vi } from 'vitest';

import { createLazyDuckDbClient } from './lazy-client';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function createClientModule() {
	return {
		executeDuckDbSql: vi.fn().mockResolvedValue({ rows: [] }),
		executeDuckDbQuery: vi.fn(),
		isPersistentDuckDbSession: vi.fn(),
		getDuckDbInternalCatalogName: vi.fn(),
		checkpointDuckDb: vi.fn(),
		createDuckDbDatabase: vi.fn(),
		dropDuckDbDatabase: vi.fn(),
		startDuckDbFileQuery: vi.fn(),
		disposeDuckDb: vi.fn(),
		disposeInactiveDuckDbSessions: vi.fn(),
		disposeAllDuckDbSessions: vi.fn()
	};
}

describe('lazy DuckDB client', () => {
	it('rejects browser-only operations outside a browser', async () => {
		const importClient = vi.fn();
		const client = createLazyDuckDbClient({ isBrowser: false, importClient });

		await expect(client.executeDuckDbSql('select 1', 'cluster')).rejects.toThrow(
			'available only in a browser'
		);
		expect(importClient).not.toHaveBeenCalled();
	});

	it('shares one import within a runtime and forwards calls', async () => {
		const module = createClientModule();
		const importClient = vi.fn().mockResolvedValue(module);
		const client = createLazyDuckDbClient({
			isBrowser: true,
			importClient: importClient as never
		});

		await Promise.all([
			client.executeDuckDbSql('select 1', 'cluster'),
			client.executeDuckDbSql('select 2', 'cluster')
		]);

		expect(importClient).toHaveBeenCalledOnce();
		expect(module.executeDuckDbSql).toHaveBeenNthCalledWith(1, 'select 1', 'cluster');
		expect(module.executeDuckDbSql).toHaveBeenNthCalledWith(2, 'select 2', 'cluster');
	});

	it('retries an import after a loading failure', async () => {
		const module = createClientModule();
		const importClient = vi
			.fn()
			.mockRejectedValueOnce(new Error('chunk failed'))
			.mockResolvedValueOnce(module);
		const client = createLazyDuckDbClient({
			isBrowser: true,
			importClient: importClient as never
		});

		await expect(client.executeDuckDbSql('select 1', 'cluster')).rejects.toThrow('chunk failed');
		await expect(client.executeDuckDbSql('select 1', 'cluster')).resolves.toEqual({ rows: [] });
		expect(importClient).toHaveBeenCalledTimes(2);
	});

	it('cancels before the deferred client finishes loading', async () => {
		const loaded = deferred<ReturnType<typeof createClientModule>>();
		const module = createClientModule();
		const client = createLazyDuckDbClient({
			isBrowser: true,
			importClient: (() => loaded.promise) as never
		});
		const execution = client.startDuckDbFileQuery({} as never);

		execution.cancel();
		loaded.resolve(module);

		await expect(execution.promise).rejects.toThrow('Query cancelled.');
		expect(module.startDuckDbFileQuery).not.toHaveBeenCalled();
	});

	it('does not load the client solely for disposal', async () => {
		const importClient = vi.fn();
		const client = createLazyDuckDbClient({ isBrowser: true, importClient });

		await client.disposeDuckDb('cluster');
		await client.disposeAllDuckDbSessions();

		expect(importClient).not.toHaveBeenCalled();
	});
});
