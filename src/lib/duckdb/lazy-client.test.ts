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

	it('forwards every promise-based operation to the loaded client', async () => {
		const module = createClientModule();
		const importClient = vi.fn().mockResolvedValue(module);
		const client = createLazyDuckDbClient({
			isBrowser: true,
			importClient: importClient as never
		});

		await client.executeDuckDbQuery('select 1', 'cluster');
		await client.isPersistentDuckDbSession('cluster');
		await client.getDuckDbInternalCatalogName('cluster');
		await client.checkpointDuckDb('cluster');
		await client.createDuckDbDatabase('cluster', 'Analytics');
		await client.dropDuckDbDatabase('cluster', 'Analytics', 'memory');

		expect(module.executeDuckDbQuery).toHaveBeenCalledWith('select 1', 'cluster');
		expect(module.isPersistentDuckDbSession).toHaveBeenCalledWith('cluster');
		expect(module.getDuckDbInternalCatalogName).toHaveBeenCalledWith('cluster');
		expect(module.checkpointDuckDb).toHaveBeenCalledWith('cluster');
		expect(module.createDuckDbDatabase).toHaveBeenCalledWith('cluster', 'Analytics');
		expect(module.dropDuckDbDatabase).toHaveBeenCalledWith('cluster', 'Analytics', 'memory');
		expect(importClient).toHaveBeenCalledOnce();
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

	it('forwards cancellation after a file query starts', async () => {
		const query = deferred<unknown>();
		const cancel = vi.fn();
		const module = createClientModule();
		module.startDuckDbFileQuery.mockReturnValue({ promise: query.promise, cancel });
		const client = createLazyDuckDbClient({
			isBrowser: true,
			importClient: vi.fn().mockResolvedValue(module) as never
		});
		const options = { sessionId: 'cluster' } as never;
		const execution = client.startDuckDbFileQuery(options);

		await vi.waitFor(() => expect(module.startDuckDbFileQuery).toHaveBeenCalledWith(options));
		execution.cancel();
		query.resolve({ rows: [] });

		await expect(execution.promise).resolves.toEqual({ rows: [] });
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('does not load the client solely for disposal', async () => {
		const importClient = vi.fn();
		const client = createLazyDuckDbClient({ isBrowser: true, importClient });

		await client.disposeDuckDb('cluster');
		await client.disposeAllDuckDbSessions();

		expect(importClient).not.toHaveBeenCalled();
	});

	it('forwards disposal after the client has loaded', async () => {
		const module = createClientModule();
		const client = createLazyDuckDbClient({
			isBrowser: true,
			importClient: vi.fn().mockResolvedValue(module) as never
		});
		await client.executeDuckDbSql('select 1', 'cluster');

		await client.disposeDuckDb('cluster');
		await client.disposeInactiveDuckDbSessions('active');
		await client.disposeAllDuckDbSessions();

		expect(module.disposeDuckDb).toHaveBeenCalledWith('cluster');
		expect(module.disposeInactiveDuckDbSessions).toHaveBeenCalledWith('active');
		expect(module.disposeAllDuckDbSessions).toHaveBeenCalledOnce();
	});
});
