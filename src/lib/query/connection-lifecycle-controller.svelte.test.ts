import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycleMocks = vi.hoisted(() => ({
	createConnectionRuntime: vi.fn(),
	deletePersistentDuckDbStorage: vi.fn<(storageId: string) => Promise<void>>(),
	getPersistedActiveClusterId: vi.fn<() => string | undefined>(),
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
	getPersistedActiveClusterId: lifecycleMocks.getPersistedActiveClusterId,
	persistActiveClusterId: lifecycleMocks.persistActiveClusterId
}));

import type { ConfirmAction } from '$lib/app/confirmation-prompt.svelte';
import { createClusterSession } from '$lib/cluster/cluster-session.svelte';
import type { ClusterConnectionStore } from '$lib/cluster/cluster-connection-store.svelte';
import type { KustoClusterConnection } from '$lib/cluster/connections';
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
	const session = createClusterSession(clusters[0].id);
	const onQueryExecutionReset = vi.fn();
	const onSchemaReady = vi.fn();
	const confirm = vi.fn<ConfirmAction>().mockResolvedValue(true);
	const store = createStore([...clusters]);
	const controller = createConnectionLifecycleController({
		store,
		session,
		confirm,
		onQueryExecutionReset,
		onSchemaReady
	});
	return { controller, session, store, confirm, onQueryExecutionReset, onSchemaReady };
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
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
		const signals: AbortSignal[] = [];
		lifecycleMocks.createConnectionRuntime.mockImplementation(
			(cluster: KustoClusterConnection) => ({
				loadSchema: (signal: AbortSignal) => {
					signals.push(signal);
					return cluster.id === secondCluster.id ? second.promise : third.promise;
				}
			})
		);
		const { controller, session, onSchemaReady } = createController();

		controller.state.selectedClusterId = secondCluster.id;
		const olderRefresh = controller.refresh();
		controller.state.selectedClusterId = thirdCluster.id;
		const latestRefresh = controller.refresh();
		expect(signals[0].aborted).toBe(true);
		expect(signals[1].aborted).toBe(false);
		third.resolve(schema('ThirdDb'));
		await latestRefresh;
		second.resolve(schema('SecondDb'));
		await olderRefresh;

		expect(session.activeClusterId).toBe(thirdCluster.id);
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
		controller.state.selectedClusterId = secondCluster.id;

		await controller.refresh();

		expect(session.activeClusterId).toBe(firstCluster.id);
		expect(controller.state).toMatchObject({
			selectedClusterId: firstCluster.id,
			connectionStatus: 'error',
			connectionError: 'Cluster unavailable',
			failedClusterId: secondCluster.id
		});
	});

	it('reports an empty schema as a useful connection error', async () => {
		lifecycleMocks.createConnectionRuntime.mockReturnValue({
			loadSchema: vi.fn().mockResolvedValue({})
		});
		const { controller } = createController();

		await controller.refresh();

		expect(controller.state.connectionStatus).toBe('error');
		expect(controller.state.connectionError).toBe('The connection returned no databases.');
	});

	it('returns without loading when the selected connection no longer exists', async () => {
		const { controller } = createController();
		controller.state.selectedClusterId = 'missing';

		await controller.refresh();

		expect(lifecycleMocks.createConnectionRuntime).not.toHaveBeenCalled();
	});

	it('aborts a schema load when the connection deadline expires', async () => {
		vi.useFakeTimers();
		lifecycleMocks.createConnectionRuntime.mockReturnValue({
			loadSchema: (signal: AbortSignal) =>
				new Promise((_, reject) => {
					signal.addEventListener('abort', () => reject(signal.reason), { once: true });
				})
		});
		const { controller } = createController();

		const refresh = controller.refresh();
		await vi.advanceTimersByTimeAsync(90_000);
		await refresh;

		expect(controller.state.connectionStatus).toBe('error');
		expect(controller.state.connectionError).toBe('Schema loading timed out.');
	});

	it('leaves the current selection untouched when a dirty-tab switch is declined', async () => {
		const { controller, session, confirm, onQueryExecutionReset } = createController();
		session.updateQueryTab(session.activeQueryTabId, { query: 'StormEvents | take 1' });
		confirm.mockResolvedValue(false);

		await controller.switchCluster(secondCluster.id);

		expect(confirm).toHaveBeenCalledOnce();
		expect(controller.state.selectedClusterId).toBe(firstCluster.id);
		expect(onQueryExecutionReset).not.toHaveBeenCalled();
		expect(lifecycleMocks.createConnectionRuntime).not.toHaveBeenCalled();
	});

	it('persists removal before releasing an active emulated cluster and its storage', async () => {
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
		const { controller, session, store, confirm, onQueryExecutionReset } = createController([
			persistentCluster,
			firstCluster
		]);
		session.updateQueryTab(session.activeQueryTabId, { query: 'print Value = 1' });
		confirm.mockResolvedValue(false);

		await controller.removeCluster(persistentCluster.id);

		expect(lifecycleMocks.releaseClusterRuntime).toHaveBeenCalledWith(persistentCluster.id);
		expect(lifecycleMocks.deletePersistentDuckDbStorage).toHaveBeenCalledWith('persistent-storage');
		expect(store.remove).toHaveBeenCalledWith(persistentCluster.id);
		expect(vi.mocked(store.remove).mock.invocationCallOrder[0]).toBeLessThan(
			lifecycleMocks.releaseClusterRuntime.mock.invocationCallOrder[0]
		);
		expect(lifecycleMocks.releaseClusterRuntime.mock.invocationCallOrder[0]).toBeLessThan(
			lifecycleMocks.deletePersistentDuckDbStorage.mock.invocationCallOrder[0]
		);
		expect(confirm).not.toHaveBeenCalled();
		expect(onQueryExecutionReset).toHaveBeenCalledOnce();
		expect(session.activeClusterId).toBe(firstCluster.id);
		expect(controller.state.selectedClusterId).toBe(firstCluster.id);
		expect(session.activeClusterId).toBe(firstCluster.id);
		expect(session.queryTabs).toMatchObject([{ query: '', isRunning: false }]);
		expect(controller.state.connectionStatus).toBe('ready');
	});

	it('keeps an active emulated connection and its data intact when removal persistence fails', async () => {
		const persistentCluster: KustoClusterConnection = {
			id: 'persistent',
			name: 'Persistent',
			url: 'emulated://kite/persistent',
			kind: 'emulated',
			emulatedStorage: { mode: 'opfs', storageId: 'persistent-storage', formatVersion: 1 }
		};
		const { controller, session, store, onQueryExecutionReset } = createController([
			persistentCluster,
			firstCluster
		]);
		vi.mocked(store.remove).mockImplementationOnce(() => {
			throw new Error('Connection storage is unavailable.');
		});

		await expect(controller.removeCluster(persistentCluster.id)).rejects.toThrow(
			'Connection storage is unavailable.'
		);

		expect(lifecycleMocks.releaseClusterRuntime).not.toHaveBeenCalled();
		expect(lifecycleMocks.deletePersistentDuckDbStorage).not.toHaveBeenCalled();
		expect(onQueryExecutionReset).not.toHaveBeenCalled();
		expect(store.clusters).toContain(persistentCluster);
		expect(session.activeClusterId).toBe(persistentCluster.id);
		expect(controller.state.selectedClusterId).toBe(persistentCluster.id);
		expect(session.activeClusterId).toBe(persistentCluster.id);
	});

	it('commits removal and retains a retry when runtime cleanup fails', async () => {
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
		lifecycleMocks.releaseClusterRuntime.mockRejectedValueOnce(
			new Error('DuckDB worker did not stop.')
		);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { controller, session, store } = createController([persistentCluster, firstCluster]);

		await expect(controller.removeCluster(persistentCluster.id)).resolves.toBeUndefined();

		expect(store.clusters).not.toContain(persistentCluster);
		expect(lifecycleMocks.deletePersistentDuckDbStorage).toHaveBeenCalledOnce();
		expect(lifecycleMocks.deletePersistentDuckDbStorage).toHaveBeenCalledWith('persistent-storage');
		expect(session.activeClusterId).toBe(firstCluster.id);
		expect(controller.state.selectedClusterId).toBe(firstCluster.id);
		expect(session.activeClusterId).toBe(firstCluster.id);
		expect(controller.state.connectionStatus).toBe('ready');
		expect(console.error).toHaveBeenCalledOnce();

		lifecycleMocks.releaseClusterRuntime.mockResolvedValueOnce();
		const retryController = createController([firstCluster]).controller;
		void retryController.initialize();
		await vi.waitFor(() => {
			expect(lifecycleMocks.releaseClusterRuntime).toHaveBeenCalledTimes(2);
			expect(lifecycleMocks.deletePersistentDuckDbStorage).toHaveBeenCalledTimes(2);
		});
	});

	it('retains a retry when an ephemeral runtime cannot be released', async () => {
		const ephemeralCluster: KustoClusterConnection = {
			id: 'ephemeral',
			name: 'Ephemeral',
			url: 'emulated://kite/ephemeral',
			kind: 'emulated',
			emulatedStorage: { mode: 'memory' }
		};
		lifecycleMocks.createConnectionRuntime.mockReturnValue({
			loadSchema: vi.fn().mockResolvedValue(schema('FallbackDb'))
		});
		lifecycleMocks.releaseClusterRuntime.mockRejectedValueOnce(
			new Error('DuckDB worker did not stop.')
		);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { controller, store } = createController([ephemeralCluster, firstCluster]);

		await expect(controller.removeCluster(ephemeralCluster.id)).resolves.toBeUndefined();

		expect(store.clusters).not.toContain(ephemeralCluster);
		expect(lifecycleMocks.deletePersistentDuckDbStorage).not.toHaveBeenCalled();

		const retryController = createController([firstCluster]).controller;
		void retryController.initialize();
		await vi.waitFor(() => {
			expect(lifecycleMocks.releaseClusterRuntime).toHaveBeenCalledTimes(2);
		});
		expect(lifecycleMocks.deletePersistentDuckDbStorage).not.toHaveBeenCalled();
	});

	it('commits removal and retains a retry when persistent storage cleanup fails', async () => {
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
		lifecycleMocks.deletePersistentDuckDbStorage.mockRejectedValueOnce(
			new Error('OPFS is unavailable.')
		);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { controller, store } = createController([persistentCluster, firstCluster]);

		await expect(controller.removeCluster(persistentCluster.id)).resolves.toBeUndefined();

		expect(store.clusters).not.toContain(persistentCluster);
		expect(console.error).toHaveBeenCalledOnce();

		const retryController = createController([firstCluster]).controller;
		void retryController.initialize();
		await vi.waitFor(() => {
			expect(lifecycleMocks.releaseClusterRuntime).toHaveBeenCalledTimes(2);
			expect(lifecycleMocks.deletePersistentDuckDbStorage).toHaveBeenCalledTimes(2);
		});
	});

	it('clears a failed retry target when that connection is removed', async () => {
		lifecycleMocks.createConnectionRuntime.mockReturnValue({
			loadSchema: vi.fn().mockRejectedValue(new Error('Cluster unavailable'))
		});
		const { controller, session } = createController();
		session.databaseSchema = schema('FirstDb');
		controller.state.selectedClusterId = secondCluster.id;
		await controller.refresh();

		await controller.removeCluster(secondCluster.id);

		expect(controller.state.failedClusterId).toBeUndefined();
		expect(controller.state.connectionError).toBe('');
		expect(controller.state.connectionStatus).toBe('ready');
	});

	it('ignores a stale schema response after its connection is removed', async () => {
		const staleSchema = deferred<KustoDatabaseSchema>();
		lifecycleMocks.createConnectionRuntime.mockImplementation(
			(cluster: KustoClusterConnection) => ({
				loadSchema: () =>
					cluster.id === secondCluster.id
						? staleSchema.promise
						: Promise.resolve(schema('FallbackDb'))
			})
		);
		const { controller, session } = createController();
		controller.state.selectedClusterId = secondCluster.id;
		const staleRefresh = controller.refresh();

		await controller.removeCluster(secondCluster.id);
		staleSchema.resolve(schema('RemovedDb'));
		await staleRefresh;

		expect(session.activeClusterId).toBe(firstCluster.id);
		expect(controller.state.selectedClusterId).toBe(firstCluster.id);
		expect(session.activeClusterId).toBe(firstCluster.id);
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

	describe('initialize', () => {
		const logAnalyticsCluster: KustoClusterConnection = {
			id: 'logs',
			name: 'Logs',
			url: 'https://api.loganalytics.azure.com',
			kind: 'log-analytics',
			logAnalytics: { workspaceId: 'workspace', tenantId: 'tenant', clientId: 'client' }
		};

		it('waits for hydration, then restores the persisted connection once', async () => {
			const loadSchema = vi.fn().mockResolvedValue(schema('SecondDb'));
			lifecycleMocks.createConnectionRuntime.mockReturnValue({ loadSchema });
			lifecycleMocks.getPersistedActiveClusterId.mockReturnValue(secondCluster.id);
			const { controller, session, store } = createController();
			(store as { hydrated: boolean }).hydrated = false;

			controller.initialize();
			expect(loadSchema).not.toHaveBeenCalled();

			(store as { hydrated: boolean }).hydrated = true;
			controller.initialize();
			controller.initialize();
			await vi.waitFor(() => expect(controller.state.connectionStatus).toBe('ready'));

			expect(loadSchema).toHaveBeenCalledOnce();
			expect(session.activeClusterId).toBe(secondCluster.id);
			expect(session.selectedDatabase).toBe('SecondDb');
		});

		it('keeps a loaded schema instead of reloading or applying the persisted connection', () => {
			lifecycleMocks.getPersistedActiveClusterId.mockReturnValue(secondCluster.id);
			const { controller, session } = createController();
			session.databaseSchema = schema('FirstDb');

			controller.initialize();

			expect(lifecycleMocks.createConnectionRuntime).not.toHaveBeenCalled();
			expect(controller.state.selectedClusterId).toBe(firstCluster.id);
		});

		it('reloads a Log Analytics schema after its freshness window', async () => {
			vi.useFakeTimers();
			const loadSchema = vi.fn().mockResolvedValue(schema('Logs'));
			lifecycleMocks.createConnectionRuntime.mockReturnValue({ loadSchema });
			const fresh = createController([logAnalyticsCluster]);
			fresh.session.databaseSchema = schema('Logs');
			fresh.controller.initialize();
			expect(loadSchema).not.toHaveBeenCalled();

			const stale = createController([logAnalyticsCluster]);
			stale.session.databaseSchema = schema('Logs');
			await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
			stale.controller.initialize();
			expect(loadSchema).toHaveBeenCalledOnce();
		});
	});

	it('restores the session selection when its connection reloads', async () => {
		lifecycleMocks.createConnectionRuntime.mockReturnValue({
			loadSchema: vi.fn().mockResolvedValue({ ...schema('OtherDb'), ...schema('FirstDb') })
		});
		const { controller, session } = createController();
		session.selectedDatabase = 'FirstDb';
		session.selectedTable = 'Events';

		await controller.refresh();

		expect(session.selectedDatabase).toBe('FirstDb');
		expect(session.selectedTable).toBe('Events');
	});

	it('ignores a new switch while another connection switch is in progress', async () => {
		const pending = deferred<KustoDatabaseSchema>();
		lifecycleMocks.createConnectionRuntime.mockReturnValue({ loadSchema: () => pending.promise });
		const { controller, session } = createController();
		session.databaseSchema = schema('FirstDb');

		controller.switchCluster(secondCluster.id);
		expect(controller.state.isClusterSwitching).toBe(true);
		controller.switchCluster(thirdCluster.id);

		expect(controller.state.selectedClusterId).toBe(secondCluster.id);
		pending.resolve(schema('SecondDb'));
		await vi.waitFor(() => expect(session.activeClusterId).toBe(secondCluster.id));
	});

	it('connects to a requested cluster and reports whether it became ready', async () => {
		lifecycleMocks.createConnectionRuntime.mockImplementation(
			(cluster: KustoClusterConnection) => ({
				loadSchema: () =>
					cluster.id === thirdCluster.id
						? Promise.reject(new Error('Unreachable.'))
						: Promise.resolve(schema(`${cluster.name}Db`))
			})
		);
		const { controller, session } = createController();

		await expect(controller.connect(secondCluster.id)).resolves.toBe(true);
		expect(controller.activeCluster?.id).toBe(secondCluster.id);
		expect(session.selectedDatabase).toBe('SecondDb');

		await expect(controller.connect(thirdCluster.id)).resolves.toBe(false);
		expect(controller.state.connectionError).toBe('Unreachable.');
		expect(controller.activeCluster?.id).toBe(secondCluster.id);
	});

	it('restores the selected function when its database reloads', async () => {
		const withFunction: KustoDatabaseSchema = {
			FirstDb: {
				...schema('FirstDb').FirstDb,
				functions: [{ name: 'Recent', body: '{}', inputParameters: [] }]
			}
		};
		lifecycleMocks.createConnectionRuntime.mockReturnValue({
			loadSchema: () => Promise.resolve(withFunction)
		});
		const { controller, session } = createController();
		session.selectedFunction = 'Recent';

		await controller.refresh();
		expect(session.selectedFunction).toBe('Recent');

		session.selectedFunction = 'Missing';
		await controller.refresh();
		expect(session.selectedFunction).toBeUndefined();
	});

	it('adds a connection by switching to it', async () => {
		lifecycleMocks.createConnectionRuntime.mockReturnValue({
			loadSchema: () => Promise.resolve(schema('ThirdDb'))
		});
		const { controller, store, onQueryExecutionReset } = createController();
		vi.mocked(store.add).mockReturnValue(thirdCluster);

		await controller.addCluster({ name: 'Third', url: thirdCluster.url, kind: 'remote' });
		expect(controller.state.selectedClusterId).toBe(thirdCluster.id);
		expect(onQueryExecutionReset).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(controller.state.connectionStatus).toBe('ready'));
	});

	it('reloads only the selected connection after it is edited', async () => {
		lifecycleMocks.createConnectionRuntime.mockReturnValue({
			loadSchema: () => Promise.resolve(schema('FirstDb'))
		});
		const { controller, store, onQueryExecutionReset } = createController();
		const draft = { name: 'Renamed', url: secondCluster.url, kind: 'remote' as const };

		controller.editCluster(secondCluster.id, draft);
		expect(store.update).toHaveBeenCalledWith(secondCluster.id, draft);
		expect(onQueryExecutionReset).not.toHaveBeenCalled();
		expect(lifecycleMocks.createConnectionRuntime).not.toHaveBeenCalled();

		controller.editCluster(firstCluster.id, draft);
		expect(onQueryExecutionReset).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(controller.state.connectionStatus).toBe('ready'));
	});
});
