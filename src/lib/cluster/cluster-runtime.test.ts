import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
	disposeAllDuckDbSessions: vi.fn<() => Promise<void>>(),
	disposeDuckDb: vi.fn<(sessionId: string) => Promise<void>>(),
	disposeInactiveDuckDbSessions: vi.fn<(activeSessionId?: string) => Promise<void>>(),
	getMockClusterSchema: vi.fn(),
	loadBackendSchema: vi.fn(),
	loadEmulatedSchema: vi.fn(),
	loadLogAnalyticsSchema: vi.fn(),
	registerEmulatedStorage: vi.fn(),
	startEmulatedQuery: vi.fn(),
	startKustoQuery: vi.fn(),
	startLogAnalyticsQuery: vi.fn()
}));

vi.mock('$lib/duckdb/lazy-client', () => ({
	disposeAllDuckDbSessions: runtimeMocks.disposeAllDuckDbSessions,
	disposeDuckDb: runtimeMocks.disposeDuckDb,
	disposeInactiveDuckDbSessions: runtimeMocks.disposeInactiveDuckDbSessions
}));
vi.mock('$lib/emulation/cluster', () => ({
	loadEmulatedSchema: runtimeMocks.loadEmulatedSchema,
	startEmulatedQuery: runtimeMocks.startEmulatedQuery
}));
vi.mock('$lib/emulation/storage', () => ({
	registerEmulatedStorage: runtimeMocks.registerEmulatedStorage
}));
vi.mock('$lib/kusto/backend-schema', () => ({
	loadBackendSchema: runtimeMocks.loadBackendSchema
}));
vi.mock('$lib/kusto/query-client', () => ({
	startKustoQuery: runtimeMocks.startKustoQuery
}));
vi.mock('$lib/log-analytics/client', () => ({
	loadLogAnalyticsSchema: runtimeMocks.loadLogAnalyticsSchema,
	startLogAnalyticsQuery: runtimeMocks.startLogAnalyticsQuery
}));
vi.mock('./mock-cluster-schema', () => ({
	getMockClusterSchema: runtimeMocks.getMockClusterSchema
}));

import {
	createConnectionRuntime,
	getClusterDriver,
	releaseAllClusterRuntimes,
	releaseClusterRuntime
} from './cluster-runtime';
import type { KustoClusterConnection } from '$lib/kusto/query-client';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

const schema: KustoDatabaseSchema = {
	memory: { name: 'memory', tables: [], functions: [] }
};
const emulatedCluster: KustoClusterConnection = {
	id: 'emulated-1',
	name: 'Emulated',
	url: 'emulated://kite/emulated-1',
	kind: 'emulated',
	emulatedStorage: { mode: 'memory' }
};
const remoteCluster: KustoClusterConnection = {
	id: 'remote-1',
	name: 'Remote',
	url: 'https://example.kusto.windows.net',
	kind: 'remote'
};
const mockCluster: KustoClusterConnection = {
	id: 'mock-1',
	name: 'Mock',
	url: 'mock://kite/mock-1',
	kind: 'mock'
};
const logAnalyticsCluster: KustoClusterConnection = {
	id: 'logs-1',
	name: 'Logs',
	url: 'https://api.loganalytics.azure.com',
	kind: 'log-analytics',
	logAnalytics: {
		workspaceId: 'workspace-id',
		tenantId: 'tenant-id',
		clientId: 'client-id'
	}
};

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.disposeAllDuckDbSessions.mockResolvedValue();
	runtimeMocks.disposeDuckDb.mockResolvedValue();
	runtimeMocks.disposeInactiveDuckDbSessions.mockResolvedValue();
	runtimeMocks.getMockClusterSchema.mockReturnValue(schema);
	runtimeMocks.loadBackendSchema.mockResolvedValue(schema);
	runtimeMocks.loadEmulatedSchema.mockResolvedValue(schema);
	runtimeMocks.loadLogAnalyticsSchema.mockResolvedValue(schema);
});

describe('cluster runtime lifecycle', () => {
	it('provides the same driver contract for every cluster kind', () => {
		for (const cluster of [remoteCluster, logAnalyticsCluster, mockCluster, emulatedCluster]) {
			const driver = getClusterDriver(cluster);
			expect(driver.kind).toBe(cluster.kind);
			expect(driver.capabilities).toBeTypeOf('function');
			expect(driver.loadSchema).toBeTypeOf('function');
			expect(driver.startQuery).toBeTypeOf('function');
			expect(driver.dispose).toBeTypeOf('function');
		}
	});

	it('releases inactive DuckDB sessions before opening an emulated cluster', async () => {
		await expect(createConnectionRuntime(emulatedCluster).loadSchema()).resolves.toBe(schema);

		expect(runtimeMocks.registerEmulatedStorage).toHaveBeenCalledWith(
			emulatedCluster.id,
			emulatedCluster.emulatedStorage
		);
		expect(runtimeMocks.disposeInactiveDuckDbSessions).toHaveBeenCalledWith(emulatedCluster.id);
		expect(runtimeMocks.disposeInactiveDuckDbSessions.mock.invocationCallOrder[0]).toBeLessThan(
			runtimeMocks.loadEmulatedSchema.mock.invocationCallOrder[0]
		);
	});

	it('keeps the active DuckDB session until a remote cluster has connected', async () => {
		await expect(createConnectionRuntime(remoteCluster).loadSchema()).resolves.toBe(schema);

		expect(runtimeMocks.loadBackendSchema).toHaveBeenCalledWith(remoteCluster.url);
		expect(runtimeMocks.loadBackendSchema.mock.invocationCallOrder[0]).toBeLessThan(
			runtimeMocks.disposeInactiveDuckDbSessions.mock.invocationCallOrder[0]
		);

		vi.clearAllMocks();
		runtimeMocks.loadBackendSchema.mockRejectedValueOnce(new Error('offline'));
		await expect(createConnectionRuntime(remoteCluster).loadSchema()).rejects.toThrow('offline');
		expect(runtimeMocks.disposeInactiveDuckDbSessions).not.toHaveBeenCalled();
	});

	it('does not let a stalled remote schema request block an emulated transition', async () => {
		let finishRemote!: (value: KustoDatabaseSchema) => void;
		runtimeMocks.loadBackendSchema.mockReturnValueOnce(
			new Promise<KustoDatabaseSchema>((resolve) => {
				finishRemote = resolve;
			})
		);
		const remote = createConnectionRuntime(remoteCluster)
			.loadSchema()
			.catch((error: unknown) => error);
		const emulated = createConnectionRuntime(emulatedCluster).loadSchema();

		await expect(emulated).resolves.toBe(schema);
		expect(runtimeMocks.disposeInactiveDuckDbSessions).toHaveBeenCalledWith(emulatedCluster.id);
		expect(runtimeMocks.loadEmulatedSchema).toHaveBeenCalledOnce();

		finishRemote(schema);
		expect(await remote).toMatchObject({ name: 'AbortError' });
		expect(runtimeMocks.disposeInactiveDuckDbSessions).toHaveBeenCalledTimes(1);
	});

	it('serializes cluster transitions so worker lifecycles cannot overlap', async () => {
		let finishFirstDisposal!: () => void;
		runtimeMocks.disposeInactiveDuckDbSessions.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishFirstDisposal = resolve;
				})
		);

		const first = createConnectionRuntime(emulatedCluster)
			.loadSchema()
			.catch((error: unknown) => error);
		await vi.waitFor(() =>
			expect(runtimeMocks.disposeInactiveDuckDbSessions).toHaveBeenCalledTimes(1)
		);
		const second = createConnectionRuntime({ ...emulatedCluster, id: 'emulated-2' }).loadSchema();
		await Promise.resolve();
		expect(runtimeMocks.disposeInactiveDuckDbSessions).toHaveBeenCalledTimes(1);

		finishFirstDisposal();
		expect(await first).toMatchObject({ name: 'AbortError' });
		await second;
		expect(runtimeMocks.disposeInactiveDuckDbSessions).toHaveBeenNthCalledWith(2, 'emulated-2');
	});

	it('dispatches queries through the connection runtime', () => {
		const execution = { cancel: vi.fn(), promise: Promise.resolve({}) };
		runtimeMocks.startEmulatedQuery.mockReturnValue(execution);
		runtimeMocks.startKustoQuery.mockReturnValue(execution);

		expect(
			createConnectionRuntime(emulatedCluster).startQuery('memory', 'StormEvents | take 1')
		).toBe(execution);
		expect(runtimeMocks.startEmulatedQuery).toHaveBeenCalledWith(
			emulatedCluster.id,
			'memory',
			'StormEvents | take 1'
		);

		expect(createConnectionRuntime(remoteCluster).startQuery('db', 'T | take 1')).toBe(execution);
		expect(runtimeMocks.startKustoQuery).toHaveBeenCalledWith(
			'db',
			'T | take 1',
			remoteCluster.url
		);

		expect(() => createConnectionRuntime(mockCluster).startQuery('db', 'T')).toThrow(
			'Queries are unavailable for this connection.'
		);
	});

	it('releases one removed cluster or every runtime on workspace teardown', async () => {
		await createConnectionRuntime(emulatedCluster).dispose();
		await releaseClusterRuntime(emulatedCluster.id);
		await releaseAllClusterRuntimes();

		expect(runtimeMocks.disposeDuckDb).toHaveBeenCalledTimes(2);
		expect(runtimeMocks.disposeDuckDb).toHaveBeenNthCalledWith(1, emulatedCluster.id);
		expect(runtimeMocks.disposeDuckDb).toHaveBeenNthCalledWith(2, emulatedCluster.id);
		expect(runtimeMocks.disposeAllDuckDbSessions).toHaveBeenCalledOnce();
	});
});
