import type { ConfirmAction } from '$lib/app/confirmation-prompt.svelte';
import type { ClusterSession } from '$lib/cluster/cluster-session.svelte';
import { createConnectionRuntime } from '$lib/cluster/cluster-runtime';
import {
	getPersistedActiveClusterId,
	persistActiveClusterId
} from '$lib/cluster/active-cluster-preference';
import type {
	ClusterConnectionStore,
	NewClusterConnection
} from '$lib/cluster/cluster-connection-store.svelte';
import { getErrorMessage } from '$lib/query/error-message';
import {
	discardRemovedClusterCleanup,
	retryRemovedClusterCleanups,
	runRemovedClusterCleanup,
	stageRemovedClusterCleanup
} from './removed-cluster-cleanup';

export type ConnectionState = 'loading' | 'ready' | 'error';

/**
 * Connection transition state only. The confirmed connection, its schema, and the Explorer
 * selection belong to `ClusterSession` so every workspace reads one copy.
 */
export type ConnectionLifecycleState = {
	connectionStatus: ConnectionState;
	isClusterSwitching: boolean;
	showLogAnalyticsSignInTip: boolean;
	connectionError: string;
	failedClusterId?: string;
	/** Connection chosen in the selector; it becomes active once its schema loads. */
	selectedClusterId: string;
};

type ConnectionLifecycleOptions = {
	store: ClusterConnectionStore;
	session: ClusterSession;
	/** Asks before a switch discards open query tabs. */
	confirm: ConfirmAction;
	onQueryExecutionReset?: () => void;
	onSchemaReady?: (database: string, query: string | undefined) => void;
};

const SIGN_IN_TIP_DELAY_MS = 10_000;
const SCHEMA_LOAD_TIMEOUT_MS = 90_000;
/** Log Analytics tables change outside Kite; other schemas refresh only on request. */
const LOG_ANALYTICS_SCHEMA_TTL_MS = 5 * 60_000;

/** Owns cluster selection, schema loading, and stale connection-response handling. */
export function createConnectionLifecycleController(options: ConnectionLifecycleOptions) {
	const { store, session } = options;
	const state = $state<ConnectionLifecycleState>({
		connectionStatus: session.databaseSchema ? 'ready' : 'loading',
		isClusterSwitching: false,
		showLogAnalyticsSignInTip: false,
		connectionError: '',
		selectedClusterId: (
			store.clusters.find((cluster) => cluster.id === session.activeClusterId) ?? store.clusters[0]
		).id
	});
	let requestId = 0;
	let resetTabsAfterConnection = false;
	let initialized = false;
	let signInTipTimeout: number | undefined;
	let schemaAbortController: AbortController | undefined;

	function activeCluster() {
		return store.clusters.find((cluster) => cluster.id === session.activeClusterId);
	}

	function selectedCluster() {
		return store.clusters.find((cluster) => cluster.id === state.selectedClusterId);
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
		schemaAbortController?.abort(new DOMException('Schema load superseded.', 'AbortError'));
		const cluster = selectedCluster();
		if (!cluster) return;
		const controller = new AbortController();
		schemaAbortController = controller;
		const timeout = window.setTimeout(
			() => controller.abort(new Error('Schema loading timed out.')),
			SCHEMA_LOAD_TIMEOUT_MS
		);
		const switching = cluster.id !== session.activeClusterId;
		state.connectionStatus = 'loading';
		state.isClusterSwitching = switching && Boolean(session.databaseSchema);
		state.connectionError = '';
		if (cluster.kind === 'log-analytics') scheduleSignInTip(currentRequestId, cluster.id);
		else clearSignInTip();

		try {
			const schema = await createConnectionRuntime(cluster).loadSchema(controller.signal);
			if (currentRequestId !== requestId || cluster.id !== state.selectedClusterId) return;
			const firstDatabase = Object.values(schema)[0];
			if (!firstDatabase) throw new Error('The connection returned no databases.');
			const restore = cluster.id === session.activeClusterId;
			const database = (restore ? schema[session.selectedDatabase] : undefined) ?? firstDatabase;
			const table = database.tables.some((item) => item.name === session.selectedTable)
				? session.selectedTable
				: undefined;
			const fn = database.functions?.some((item) => item.name === session.selectedFunction)
				? session.selectedFunction
				: undefined;
			const pendingQuery = restore ? session.pendingQuery : undefined;
			session.getExplorerExpansion(cluster.id);
			// The schema records the active cluster it belongs to, so commit the cluster first.
			session.activeClusterId = cluster.id;
			persistActiveClusterId(cluster.id);
			session.databaseSchema = schema;
			session.selectedDatabase = database.name;
			session.selectedTable = table;
			session.selectedFunction = fn;
			if (resetTabsAfterConnection) {
				session.resetQueryTabs(database.name);
				resetTabsAfterConnection = false;
			}
			options.onSchemaReady?.(database.name, pendingQuery);
			session.pendingQuery = undefined;
			clearSignInTip();
			state.connectionStatus = 'ready';
			state.isClusterSwitching = false;
			state.failedClusterId = undefined;
		} catch (error) {
			if (currentRequestId !== requestId) return;
			resetTabsAfterConnection = false;
			clearSignInTip();
			state.connectionError = getErrorMessage(error);
			state.failedClusterId = cluster.id;
			state.isClusterSwitching = false;
			if (session.databaseSchema) state.selectedClusterId = session.activeClusterId;
			state.connectionStatus = 'error';
		} finally {
			window.clearTimeout(timeout);
			if (schemaAbortController === controller) schemaAbortController = undefined;
		}
	}

	/** Loads `clusterId` (the selected connection by default) and reports whether it is ready. */
	async function connect(clusterId = state.selectedClusterId) {
		state.selectedClusterId = clusterId;
		await refresh();
		return state.connectionStatus === 'ready';
	}

	/**
	 * Restores the last confirmed connection once custom connections have hydrated, resumes any
	 * interrupted cleanup, and loads the schema unless the session already holds a fresh one.
	 */
	function initialize() {
		if (initialized || !store.hydrated) return;
		initialized = true;
		void retryRemovedClusterCleanups(new Set(store.clusters.map((cluster) => cluster.id)));
		const persistedClusterId = getPersistedActiveClusterId();
		if (
			!session.databaseSchema &&
			persistedClusterId &&
			store.clusters.some((cluster) => cluster.id === persistedClusterId)
		) {
			state.selectedClusterId = persistedClusterId;
		}
		const maxSchemaAgeMs =
			selectedCluster()?.kind === 'log-analytics'
				? LOG_ANALYTICS_SCHEMA_TTL_MS
				: Number.POSITIVE_INFINITY;
		if (!session.isSchemaFresh(state.selectedClusterId, maxSchemaAgeMs)) void refresh();
	}

	async function switchCluster(clusterId: string) {
		const isRedundant = () => clusterId === state.selectedClusterId || state.isClusterSwitching;
		if (isRedundant()) return;
		if (
			session.queryTabs.some((tab) => tab.query.trim()) &&
			!(await options.confirm({
				title: 'Switch connection?',
				description: 'Switching connections will close all query tabs.',
				actionLabel: 'Switch connection'
			}))
		)
			return;
		// Another switch may have started while the confirmation was open.
		if (isRedundant()) return;
		options.onQueryExecutionReset?.();
		resetTabsAfterConnection = true;
		state.selectedClusterId = clusterId;
		void refresh();
	}

	function addCluster(draft: NewClusterConnection) {
		return switchCluster(store.add(draft).id);
	}

	function editCluster(clusterId: string, draft: NewClusterConnection) {
		store.update(clusterId, draft);
		if (clusterId !== state.selectedClusterId) return;
		options.onQueryExecutionReset?.();
		void refresh();
	}

	async function removeCluster(clusterId: string) {
		const wasSelected =
			clusterId === state.selectedClusterId || clusterId === session.activeClusterId;
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
			if (state.connectionStatus === 'error' && session.databaseSchema) {
				state.connectionStatus = 'ready';
			}
		}

		if (fallbackCluster) {
			// Removal was already confirmed by the destructive dialog. Transition directly instead of
			// offering a second, cancellable switch that could leave the deleted connection active.
			options.onQueryExecutionReset?.();
			session.resetQueryTabs();
			session.pendingQuery = undefined;
			session.databaseSchema = undefined;
			session.selectedDatabase = '';
			session.selectedTable = undefined;
			session.selectedFunction = undefined;
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
		initialize,
		refresh,
		connect,
		switchCluster,
		addCluster,
		editCluster,
		removeCluster,
		retry,
		dismissFailure,
		dispose() {
			requestId += 1;
			schemaAbortController?.abort(new DOMException('Workspace disposed.', 'AbortError'));
			schemaAbortController = undefined;
			clearSignInTip();
		}
	};
}
