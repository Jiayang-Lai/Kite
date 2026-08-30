import type { ClusterSession } from '$lib/cluster/cluster-session.svelte';
import { createConnectionRuntime, type ConnectionRuntime } from '$lib/cluster/cluster-runtime';
import { persistActiveClusterId } from '$lib/cluster/active-cluster-preference';
import type {
	ClusterConnectionStore,
	NewClusterConnection
} from '$lib/cluster/cluster-connection-store.svelte';
import { getKustoErrorMessage, type KustoClusterConnection } from '$lib/kusto/query-client';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
import {
	discardRemovedClusterCleanup,
	retryRemovedClusterCleanups,
	runRemovedClusterCleanup,
	stageRemovedClusterCleanup
} from './removed-cluster-cleanup';

export type ConnectionState = 'loading' | 'ready' | 'error';

export type ConnectionLifecycleState = {
	databaseSchema?: KustoDatabaseSchema;
	connectionStatus: ConnectionState;
	isClusterSwitching: boolean;
	showLogAnalyticsSignInTip: boolean;
	connectionError: string;
	failedClusterId?: string;
	selectedDatabase: string;
	selectedTable?: string;
	selectedFunction?: string;
	activeClusterId: string;
	activeClusterUrl: string;
	selectedClusterId: string;
};

type ConnectionLifecycleOptions = {
	store: ClusterConnectionStore;
	session: ClusterSession;
	initialCluster: KustoClusterConnection;
	onQueryExecutionReset: () => void;
	onSchemaReady: (database: string, query: string | undefined) => void;
	onstatechange?: () => void;
};

const SIGN_IN_TIP_DELAY_MS = 10_000;

/** Owns cluster selection, schema loading, and stale connection-response handling. */
export function createConnectionLifecycleController(options: ConnectionLifecycleOptions) {
	const { store, session, initialCluster } = options;
	const state = $state<ConnectionLifecycleState>({
		databaseSchema: session.databaseSchema,
		connectionStatus: 'loading',
		isClusterSwitching: false,
		showLogAnalyticsSignInTip: false,
		connectionError: '',
		selectedDatabase: session.selectedDatabase,
		selectedTable: session.selectedTable,
		selectedFunction: session.selectedFunction,
		activeClusterId: initialCluster.id,
		activeClusterUrl: initialCluster.url,
		selectedClusterId: initialCluster.id
	});
	let requestId = 0;
	let resetTabsAfterConnection = false;
	let signInTipTimeout: number | undefined;

	function activeCluster() {
		return store.clusters.find((cluster) => cluster.id === state.activeClusterId);
	}

	function selectedCluster() {
		return store.clusters.find((cluster) => cluster.id === state.selectedClusterId);
	}

	function runtime(): ConnectionRuntime | undefined {
		const cluster = activeCluster();
		return cluster ? createConnectionRuntime(cluster) : undefined;
	}

	function clearSignInTip() {
		if (signInTipTimeout !== undefined) window.clearTimeout(signInTipTimeout);
		signInTipTimeout = undefined;
		state.showLogAnalyticsSignInTip = false;
	}

	function scheduleSignInTip(currentRequestId: number, clusterId: string) {
		clearSignInTip();
		signInTipTimeout = window.setTimeout(() => {
			signInTipTimeout = undefined;
			if (
				currentRequestId === requestId &&
				clusterId === state.selectedClusterId &&
				state.connectionStatus === 'loading'
			) {
				state.showLogAnalyticsSignInTip = true;
			}
		}, SIGN_IN_TIP_DELAY_MS);
	}

	async function refresh() {
		const currentRequestId = ++requestId;
		const cluster = selectedCluster();
		if (!cluster) return;
		const switching = cluster.id !== state.activeClusterId;
		state.connectionStatus = 'loading';
		state.isClusterSwitching = switching && Boolean(state.databaseSchema);
		state.connectionError = '';
		if (cluster.kind === 'log-analytics') scheduleSignInTip(currentRequestId, cluster.id);
		else clearSignInTip();

		try {
			const schema = await createConnectionRuntime(cluster).loadSchema();
			if (currentRequestId !== requestId || cluster.id !== state.selectedClusterId) return;
			const firstDatabase = Object.values(schema)[0];
			if (!firstDatabase) throw new Error('The connection returned no databases.');
			const restore = cluster.id === session.activeClusterId;
			const database = (restore ? schema[state.selectedDatabase] : undefined) ?? firstDatabase;
			const table = database.tables.some((item) => item.name === state.selectedTable)
				? state.selectedTable
				: undefined;
			const fn = database.functions?.some((item) => item.name === state.selectedFunction)
				? state.selectedFunction
				: undefined;
			const pendingQuery = restore ? session.pendingQuery : undefined;
			session.getExplorerExpansion(cluster.id);
			state.activeClusterId = cluster.id;
			state.activeClusterUrl = cluster.url;
			session.activeClusterId = cluster.id;
			persistActiveClusterId(cluster.id);
			state.databaseSchema = schema;
			session.databaseSchema = schema;
			state.selectedDatabase = database.name;
			state.selectedTable = table;
			state.selectedFunction = fn;
			if (resetTabsAfterConnection) {
				session.resetQueryTabs(database.name);
				resetTabsAfterConnection = false;
			}
			options.onSchemaReady(database.name, pendingQuery);
			session.pendingQuery = undefined;
			clearSignInTip();
			state.connectionStatus = 'ready';
			state.isClusterSwitching = false;
			state.failedClusterId = undefined;
			options.onstatechange?.();
		} catch (error) {
			if (currentRequestId !== requestId) return;
			resetTabsAfterConnection = false;
			clearSignInTip();
			state.connectionError = getKustoErrorMessage(error);
			state.failedClusterId = cluster.id;
			state.isClusterSwitching = false;
			if (state.databaseSchema) state.selectedClusterId = state.activeClusterId;
			state.connectionStatus = 'error';
			options.onstatechange?.();
		}
	}

	function switchCluster(clusterId: string) {
		if (clusterId === state.selectedClusterId) return;
		if (
			session.queryTabs.some((tab) => tab.query.trim()) &&
			!window.confirm('Switching connections will close all query tabs. Continue?')
		)
			return;
		options.onQueryExecutionReset();
		resetTabsAfterConnection = true;
		state.selectedClusterId = clusterId;
		void refresh();
	}

	function addCluster(draft: NewClusterConnection) {
		switchCluster(store.add(draft).id);
	}

	function editCluster(clusterId: string, draft: NewClusterConnection) {
		store.update(clusterId, draft);
		if (clusterId !== state.selectedClusterId) return;
		options.onQueryExecutionReset();
		void refresh();
	}

	async function removeCluster(clusterId: string) {
		const wasSelected =
			clusterId === state.selectedClusterId || clusterId === state.activeClusterId;
		const cluster = store.clusters.find((item) => item.id === clusterId);
		const fallbackCluster = wasSelected
			? store.clusters.find((item) => item.id !== clusterId)
			: undefined;
		if (wasSelected && !fallbackCluster) {
			throw new Error('The active connection cannot be removed without a fallback connection.');
		}

		const cleanup = cluster ? stageRemovedClusterCleanup(cluster) : undefined;
		try {
			// Persist the connection-list change before releasing or deleting anything. If persistence
			// fails, the connection and all of its runtime and OPFS data remain intact.
			store.remove(clusterId);
		} catch (error) {
			if (cleanup) {
				try {
					discardRemovedClusterCleanup(clusterId);
				} catch {
					// A surviving staged record is harmless: retry skips it while the connection exists.
				}
			}
			throw error;
		}

		// Invalidate any schema request for the removed connection before it can restore stale state.
		requestId += 1;
		resetTabsAfterConnection = false;
		clearSignInTip();
		if (state.failedClusterId === clusterId) {
			state.failedClusterId = undefined;
			state.connectionError = '';
			if (state.connectionStatus === 'error' && state.databaseSchema) {
				state.connectionStatus = 'ready';
			}
		}

		if (fallbackCluster) {
			// Removal was already confirmed by the destructive dialog. Transition directly instead of
			// offering a second, cancellable switch that could leave the deleted connection active.
			options.onQueryExecutionReset();
			session.resetQueryTabs();
			session.pendingQuery = undefined;
			state.databaseSchema = undefined;
			session.databaseSchema = undefined;
			state.selectedDatabase = '';
			state.selectedTable = undefined;
			state.selectedFunction = undefined;
			state.activeClusterId = fallbackCluster.id;
			state.activeClusterUrl = fallbackCluster.url;
			session.activeClusterId = fallbackCluster.id;
			state.selectedClusterId = fallbackCluster.id;
			persistActiveClusterId(fallbackCluster.id);
		}

		if (cleanup) {
			try {
				await runRemovedClusterCleanup(cleanup);
				discardRemovedClusterCleanup(clusterId);
			} catch (error) {
				// Catalog removal is already durable, so cleanup failure must not report that the confirmed
				// removal failed. The staged record remains available for a later automatic retry.
				console.error(`Cleanup for removed connection ${clusterId} failed.`, error);
			}
		}

		if (fallbackCluster) await refresh();
	}

	function retry() {
		if (!state.failedClusterId) return;
		state.selectedClusterId = state.failedClusterId;
		void refresh();
	}

	function dismissFailure() {
		state.connectionStatus = 'ready';
		state.connectionError = '';
		state.failedClusterId = undefined;
	}

	return {
		state,
		get activeCluster() {
			return activeCluster();
		},
		get selectedCluster() {
			return selectedCluster();
		},
		runtime,
		refresh,
		switchCluster,
		addCluster,
		editCluster,
		removeCluster,
		retryPendingCleanups() {
			return retryRemovedClusterCleanups(new Set(store.clusters.map((cluster) => cluster.id)));
		},
		retry,
		dismissFailure,
		syncSessionSelection() {
			session.selectedDatabase = state.selectedDatabase;
			session.selectedTable = state.selectedTable;
			session.selectedFunction = state.selectedFunction;
		},
		dispose() {
			requestId += 1;
			clearSignInTip();
		}
	};
}
