import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
	disposeAllDuckDbSessions: vi.fn<() => Promise<void>>(),
	disposeDuckDb: vi.fn<(sessionId: string) => Promise<void>>(),
	disposeInactiveDuckDbSessions: vi.fn<(activeSessionId?: string) => Promise<void>>(),
	getMockClusterSchema: vi.fn(),
	loadBackendSchema: vi.fn(),
	loadEmulatedSchema: vi.fn(),
	registerEmulatedStorage: vi.fn()
}));

vi.mock('$lib/duckdb/lazy-client', () => ({
	disposeAllDuckDbSessions: runtimeMocks.disposeAllDuckDbSessions,
	disposeDuckDb: runtimeMocks.disposeDuckDb,
	disposeInactiveDuckDbSessions: runtimeMocks.disposeInactiveDuckDbSessions
}));
vi.mock('$lib/emulated/emulated-cluster', () => ({
	loadEmulatedSchema: runtimeMocks.loadEmulatedSchema
}));
vi.mock('$lib/emulated/storage', () => ({
	registerEmulatedStorage: runtimeMocks.registerEmulatedStorage
}));
vi.mock('$lib/kusto/backend-schema', () => ({
	loadBackendSchema: runtimeMocks.loadBackendSchema
}));
vi.mock('./mock-cluster-schema', () => ({
	getMockClusterSchema: runtimeMocks.getMockClusterSchema
}));

import {
	connectClusterRuntime,
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

beforeEach(() => {
	vi.clearAllMocks();
	runtimeMocks.disposeAllDuckDbSessions.mockResolvedValue();
	runtimeMocks.disposeDuckDb.mockResolvedValue();
	runtimeMocks.disposeInactiveDuckDbSessions.mockResolvedValue();
	runtimeMocks.getMockClusterSchema.mockReturnValue(schema);
	runtimeMocks.loadBackendSchema.mockResolvedValue(schema);
	runtimeMocks.loadEmulatedSchema.mockResolvedValue(schema);
});

describe('cluster runtime lifecycle', () => {
	it('releases inactive DuckDB sessions before opening an emulated cluster', async () => {
		await expect(connectClusterRuntime(emulatedCluster)).resolves.toBe(schema);

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
		await expect(connectClusterRuntime(remoteCluster)).resolves.toBe(schema);

		expect(runtimeMocks.loadBackendSchema).toHaveBeenCalledWith(remoteCluster.url);
		expect(runtimeMocks.loadBackendSchema.mock.invocationCallOrder[0]).toBeLessThan(
			runtimeMocks.disposeInactiveDuckDbSessions.mock.invocationCallOrder[0]
		);

		vi.clearAllMocks();
		runtimeMocks.loadBackendSchema.mockRejectedValueOnce(new Error('offline'));
		await expect(connectClusterRuntime(remoteCluster)).rejects.toThrow('offline');
		expect(runtimeMocks.disposeInactiveDuckDbSessions).not.toHaveBeenCalled();
	});

	it('serializes cluster transitions so worker lifecycles cannot overlap', async () => {
		let finishFirstDisposal!: () => void;
		runtimeMocks.disposeInactiveDuckDbSessions.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishFirstDisposal = resolve;
				})
		);

		const first = connectClusterRuntime(emulatedCluster);
		await vi.waitFor(() =>
			expect(runtimeMocks.disposeInactiveDuckDbSessions).toHaveBeenCalledTimes(1)
		);
		const second = connectClusterRuntime({ ...emulatedCluster, id: 'emulated-2' });
		await Promise.resolve();
		expect(runtimeMocks.disposeInactiveDuckDbSessions).toHaveBeenCalledTimes(1);

		finishFirstDisposal();
		await first;
		await second;
		expect(runtimeMocks.disposeInactiveDuckDbSessions).toHaveBeenNthCalledWith(2, 'emulated-2');
	});

	it('releases one removed cluster or every runtime on workspace teardown', async () => {
		await releaseClusterRuntime(emulatedCluster.id);
		await releaseAllClusterRuntimes();

		expect(runtimeMocks.disposeDuckDb).toHaveBeenCalledWith(emulatedCluster.id);
		expect(runtimeMocks.disposeAllDuckDbSessions).toHaveBeenCalledOnce();
	});
});
