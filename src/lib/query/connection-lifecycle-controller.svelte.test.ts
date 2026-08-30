import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycleMocks = vi.hoisted(() => ({
	createConnectionRuntime: vi.fn(),
	deletePersistentDuckDbStorage: vi.fn<(storageId: string) => Promise<void>>(),
	persistActiveClusterId: vi.fn(),
	releaseClusterRuntime: vi.fn<(clusterId: string) => Promise<void>>()
}));

vi.mock('$lib/cluster/cluster-runtime', () => ({
	createConnectionRuntime: lifecycleMocks.createConnectionRuntime,
	releaseClusterRuntime: lifecycleMocks.releaseClusterRuntime
}));
vi.mock('$lib/duckdb/storage', () => ({
	deletePersistentDuckDbStorage: lifecycleMocks.deletePersistentDuckDbStorage
}));
vi.mock('$lib/cluster/active-cluster-preference', () => ({
	persistActiveClusterId: lifecycleMocks.persistActiveClusterId
}));
vi.mock('$lib/kusto/query-client', () => ({
	getKustoErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
}));

import { createClusterSession } from '$lib/cluster/cluster-session.svelte';
import type { ClusterConnectionStore } from '$lib/cluster/cluster-connection-store.svelte';
import type { KustoClusterConnection } from '$lib/kusto/query-client';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
import { createConnectionLifecycleController } from './connection-lifecycle-controller.svelte';

const firstCluster: KustoClusterConnection = {
	id: 'first',
	name: 'First',
	url: 'https://first.example.test',
	kind: 'remote'
};
const secondCluster: KustoClusterConnection = {
	id: 'second',
	name: 'Second',
	url: 'https://second.example.test',
	kind: 'remote'
};
const thirdCluster: KustoClusterConnection = {
	id: 'third',
	name: 'Third',
	url: 'https://third.example.test',
	kind: 'remote'
};

function schema(database: string): KustoDatabaseSchema {
	return {
		[database]: {
			name: database,
			tables: [{ name: 'Events', columns: [{ name: 'Value', type: 'string' }] }],
			functions: []
		}
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createStore(clusters: KustoClusterConnection[]) {
	const store = {
		clusters,
		customClusters: clusters.slice(1),
		hydrated: true,
		hydrate: vi.fn(),
		add: vi.fn(),
		update: vi.fn(),
		updateMockSchema: vi.fn(),
		linkLogAnalyticsAuthenticationProfile: vi.fn(),
		remove: vi.fn((clusterId: string) => {
			const index = clusters.findIndex((cluster) => cluster.id === clusterId);
			if (index !== -1) clusters.splice(index, 1);
		})
	};
	return store as unknown as ClusterConnectionStore;
}

function createController(clusters = [firstCluster, secondCluster, thirdCluster]) {
	const session = createClusterSession(firstCluster.id);
	const onQueryExecutionReset = vi.fn();
	const onSchemaReady = vi.fn();
	const onstatechange = vi.fn();
	const store = createStore([...clusters]);
	const controller = createConnectionLifecycleController({
		store,
		session,
		initialCluster: clusters[0],
		onQueryExecutionReset,
		onSchemaReady,
		onstatechange
	});
	return { controller, session, store, onQueryExecutionReset, onSchemaReady, onstatechange };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(window, 'confirm').mockReturnValue(true);
	lifecycleMocks.deletePersistentDuckDbStorage.mockResolvedValue();
	lifecycleMocks.releaseClusterRuntime.mockResolvedValue();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('connection lifecycle controller', () => {
	it('ignores a stale schema response after a newer selection succeeds', async () => {
		const second = deferred<KustoDatabaseSchema>();
		const third = deferred<KustoDatabaseSchema>();
		lifecycleMocks.createConnectionRuntime.mockImplementation(
			(cluster: KustoClusterConnection) => ({
				loadSchema: () => (cluster.id === secondCluster.id ? second.promise : third.promise)
			})
		);
		const { controller, session, onSchemaReady } = createController();

		controller.state.selectedClusterId = secondCluster.id;
		const olderRefresh = controller.refresh();
		controller.state.selectedClusterId = thirdCluster.id;
		const latestRefresh = controller.refresh();
		third.resolve(schema('ThirdDb'));
		await latestRefresh;
		second.resolve(schema('SecondDb'));
		await olderRefresh;

		expect(controller.state.activeClusterId).toBe(thirdCluster.id);
		expect(session.activeClusterId).toBe(thirdCluster.id);
		expect(onSchemaReady).toHaveBeenCalledOnce();
		expect(onSchemaReady).toHaveBeenCalledWith('ThirdDb', undefined);
	});

	it('returns selection to the active cluster when a switch fails', async () => {
		lifecycleMocks.createConnectionRuntime.mockReturnValue({
			loadSchema: vi.fn().mockRejectedValue(new Error('Cluster unavailable'))
		});
		const { controller, session } = createController();
		session.databaseSchema = schema('FirstDb');
		controller.state.databaseSchema = session.databaseSchema;
		controller.state.selectedClusterId = secondCluster.id;

		await controller.refresh();

		expect(controller.state).toMatchObject({
			activeClusterId: firstCluster.id,
			selectedClusterId: firstCluster.id,
			connectionStatus: 'error',
			connectionError: 'Cluster unavailable',
			failedClusterId: secondCluster.id
		});
	});

	it('leaves the current selection untouched when a dirty-tab switch is declined', () => {
		const { controller, session, onQueryExecutionReset } = createController();
		session.updateQueryTab(session.activeQueryTabId, { query: 'StormEvents | take 1' });
		vi.mocked(window.confirm).mockReturnValue(false);

		controller.switchCluster(secondCluster.id);

		expect(controller.state.selectedClusterId).toBe(firstCluster.id);
		expect(onQueryExecutionReset).not.toHaveBeenCalled();
		expect(lifecycleMocks.createConnectionRuntime).not.toHaveBeenCalled();
	});

	it('releases persistent storage before removing an active emulated cluster', async () => {
		const persistentCluster: KustoClusterConnection = {
			id: 'persistent',
			name: 'Persistent',
			url: 'emulated://kite/persistent',
			kind: 'emulated',
			emulatedStorage: { mode: 'opfs', storageId: 'persistent-storage', formatVersion: 1 }
		};
		lifecycleMocks.createConnectionRuntime.mockReturnValue({
			loadSchema: vi.fn().mockResolvedValue(schema('FallbackDb'))
		});
		const { controller, session, store, onQueryExecutionReset } = createController([
			persistentCluster,
			firstCluster
		]);
		session.updateQueryTab(session.activeQueryTabId, { query: 'print Value = 1' });
		vi.mocked(window.confirm).mockReturnValue(false);

		await controller.removeCluster(persistentCluster.id);

		expect(lifecycleMocks.releaseClusterRuntime).toHaveBeenCalledWith(persistentCluster.id);
		expect(lifecycleMocks.deletePersistentDuckDbStorage).toHaveBeenCalledWith('persistent-storage');
		expect(store.remove).toHaveBeenCalledWith(persistentCluster.id);
		expect(window.confirm).not.toHaveBeenCalled();
		expect(onQueryExecutionReset).toHaveBeenCalledOnce();
		expect(controller.state.activeClusterId).toBe(firstCluster.id);
		expect(controller.state.selectedClusterId).toBe(firstCluster.id);
		expect(session.activeClusterId).toBe(firstCluster.id);
		expect(session.queryTabs).toMatchObject([{ query: '', isRunning: false }]);
		expect(controller.state.connectionStatus).toBe('ready');
	});

	it('clears a delayed Log Analytics sign-in prompt when disposed', async () => {
		vi.useFakeTimers();
		const pending = deferred<KustoDatabaseSchema>();
		const logAnalyticsCluster: KustoClusterConnection = {
			id: 'logs',
			name: 'Logs',
			url: 'https://api.loganalytics.azure.com',
			kind: 'log-analytics',
			logAnalytics: {
				workspaceId: 'workspace',
				tenantId: 'tenant',
				clientId: 'client'
			}
		};
		lifecycleMocks.createConnectionRuntime.mockReturnValue({ loadSchema: () => pending.promise });
		const { controller } = createController([logAnalyticsCluster]);

		const refresh = controller.refresh();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(controller.state.showLogAnalyticsSignInTip).toBe(true);

		controller.dispose();
		expect(controller.state.showLogAnalyticsSignInTip).toBe(false);
		pending.resolve(schema('Logs'));
		await refresh;
		expect(controller.state.connectionStatus).toBe('loading');
	});
});
