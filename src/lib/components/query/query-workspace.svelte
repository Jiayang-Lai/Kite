<script lang="ts">
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import BookmarkPlusIcon from '@lucide/svelte/icons/bookmark-plus';
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PanelRightCloseIcon from '@lucide/svelte/icons/panel-right-close';
	import PanelRightOpenIcon from '@lucide/svelte/icons/panel-right-open';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import XIcon from '@lucide/svelte/icons/x';
	import { mode } from 'mode-watcher';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';

	import AppHeader from '$lib/components/app/app-header.svelte';
	import AppShell from '$lib/components/app/app-shell.svelte';
	import ClusterConnectionSelector from '$lib/components/cluster/cluster-connection-selector.svelte';
	import ConnectionFailureDialog from '$lib/components/cluster/connection-failure-dialog.svelte';
	import ConnectionStatus from '$lib/components/query/connection-status.svelte';
	import DatabaseExplorer from '$lib/components/query/database-explorer.svelte';
	import type {
		ExplorerQuery,
		ExplorerSelection
	} from '$lib/components/query/database-explorer/cluster-explorer-types';
	import type { EditorDiagnostic } from '$lib/components/query/monaco-editor.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as Resizable from '$lib/components/ui/resizable';
	import * as Select from '$lib/components/ui/select';
	import { Separator } from '$lib/components/ui/separator';
	import { Spinner } from '$lib/components/ui/spinner';
	import { deletePersistentDuckDbStorage } from '$lib/duckdb/storage';
	import { LogAnalyticsQueryRequestError } from '$lib/log-analytics/client';
	import { getClusterSession } from '$lib/cluster/cluster-session.svelte';
	import type { QueryTab } from '$lib/cluster/cluster-session.svelte';
	import { createConnectionRuntime, releaseClusterRuntime } from '$lib/cluster/cluster-runtime';
	import { getConnectionCapabilities } from '$lib/cluster/connection-capabilities';
	import {
		getPersistedActiveClusterId,
		persistActiveClusterId
	} from '$lib/cluster/active-cluster-preference';
	import {
		getClusterConnectionStore,
		type NewClusterConnection
	} from '$lib/cluster/cluster-connection-store.svelte';
	import { usesBuiltInMockCatalog } from '$lib/cluster/mock-cluster-schema';
	import { MOCK_RECENT_QUERIES, MOCK_SAVED_QUERIES } from '$lib/data/mock-queries';
	import { getKustoErrorMessage } from '$lib/kusto/query-client';
	import { disposeKqlTranslator } from '$lib/kql/wasm-translator';
	import { getRecentQueryStore } from '$lib/query/recent-query-store.svelte';
	import { createConnectionLifecycleController } from '$lib/query/connection-lifecycle-controller.svelte';
	import { createQueryExecutionController } from '$lib/query/query-execution-controller.svelte';
	import { createQueryTabController } from '$lib/query/query-tab-controller.svelte';
	import { getSavedQueryStore } from '$lib/query/saved-query-store.svelte';
	import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
	import type { QueryExecution, QueryResult } from '$lib/types/query-result';
	import type { PaneAPI } from 'paneforge';

	type ConnectionState = 'loading' | 'ready' | 'error';
	type QueryWorkspaceView = 'overview' | 'editor' | 'saved-queries';
	type ComparisonSide = 'left' | 'right';
	const LOG_ANALYTICS_SIGN_IN_TIP_DELAY_MS = 10_000;
	const LOG_ANALYTICS_SCHEMA_TTL_MS = 5 * 60_000;

	type QueryWorkspaceProps = {
		view?: QueryWorkspaceView;
	};

	let { view = 'editor' }: QueryWorkspaceProps = $props();
	const explorerHeroModule = $derived(
		view === 'overview' ? import('$lib/components/explorer/explorer-hero.svelte') : undefined
	);
	const savedQueriesPageModule = $derived(
		view === 'saved-queries' ? import('$lib/components/query/saved-queries-page.svelte') : undefined
	);
	const monacoEditorModule = $derived(
		view === 'editor' ? import('$lib/components/query/monaco-editor.svelte') : undefined
	);
	const queryResultsModule = $derived(
		view === 'editor' ? import('$lib/components/query/query-results.svelte') : undefined
	);
	const databaseSchemaModule = $derived(
		view === 'editor' ? import('$lib/components/cluster/database-schema.svelte') : undefined
	);
	const clusterConnectionStore = getClusterConnectionStore();
	const initialClusters = clusterConnectionStore.clusters;
	const clusters = $derived(clusterConnectionStore.clusters);
	const customClusters = $derived(clusterConnectionStore.customClusters);
	const clusterSession = getClusterSession();
	const recentQueryStore = getRecentQueryStore();
	const savedQueryStore = getSavedQueryStore();
	const initialCluster =
		initialClusters.find((cluster) => cluster.id === clusterSession.activeClusterId) ??
		initialClusters[0];

	// Schema metadata crosses the Monaco worker boundary and must remain structured-cloneable.
	// `$state.raw` keeps the SDK-derived arrays and objects from becoming Svelte proxies.
	let databaseSchema = $state.raw<KustoDatabaseSchema | undefined>(clusterSession.databaseSchema);
	let connectionStatus = $state<ConnectionState>('loading');
	let isClusterSwitching = $state(false);
	let showLogAnalyticsSignInTip = $state(false);
	let connectionError = $state('');
	let failedClusterId = $state<string>();
	let explorerFilter = $state('');
	let hasInitializedConnection = false;
	let selectedDatabase = $state(clusterSession.selectedDatabase);
	let selectedTable = $state(clusterSession.selectedTable);
	let selectedFunction = $state(clusterSession.selectedFunction);
	const executionState = $state({
		queryText: '',
		result: undefined as QueryResult | undefined,
		error: '',
		errorRequestId: undefined as string | undefined,
		errorRaw: undefined as unknown,
		isRunning: false,
		resultsCollapsed: false
	});
	let languageServiceStatus = $state<'idle' | 'loading' | 'ready'>('idle');
	let saveQueryDialogOpen = $state(false);
	let savedQueryName = $state('');
	let savedQueryNameError = $state('');
	let pendingSaveTabId = $state<string>();
	let resultsPane = $state<PaneAPI>();
	let databaseSchemaPane = $state<PaneAPI>();
	let databaseSchemaCollapsed = $state(false);
	let resetTabsAfterConnection = false;
	let editorComponent = $state<{ getDiagnostics: () => EditorDiagnostic[] }>();
	let queryTabList = $state<HTMLDivElement>();
	let queryTabListCanScrollLeft = $state(false);
	let queryTabListCanScrollRight = $state(false);
	let queryTabDragPointerId = $state<number>();
	let queryTabDragStartX = 0;
	let queryTabDragStartScrollLeft = 0;
	let ignoreQueryTabClick = false;
	const tabComparisonState = $state({
		comparisonOriginalTabId: undefined as string | undefined,
		comparisonModifiedTabId: undefined as string | undefined,
		focusedComparisonSide: 'right' as ComparisonSide
	});
	let schemaRequestId = 0;
	let logAnalyticsSignInTipTimeout: number | undefined;

	let activeClusterId = $state(initialCluster.id);
	let activeClusterUrl = $state(initialCluster.url);
	let selectedClusterId = $state(initialCluster.id);
	const hasCluster = $derived(Boolean(databaseSchema));
	const queryTabs = $derived(clusterSession.queryTabs);
	const activeQueryTabId = $derived(clusterSession.activeQueryTabId);
	const activeQueryTab = $derived(clusterSession.getQueryTab(activeQueryTabId));
	const comparisonModifiedTab = $derived(
		tabComparisonState.comparisonModifiedTabId
			? queryTabs.find((tab) => tab.id === tabComparisonState.comparisonModifiedTabId)
			: activeQueryTab
	);
	const compareCandidates = $derived(
		comparisonModifiedTab
			? queryTabs.filter(
					(tab) =>
						tab.id !== comparisonModifiedTab.id &&
						tab.database.trim().toLowerCase() ===
							comparisonModifiedTab.database.trim().toLowerCase()
				)
			: []
	);
	const comparisonOriginalTab = $derived(
		tabComparisonState.comparisonOriginalTabId
			? compareCandidates.find((tab) => tab.id === tabComparisonState.comparisonOriginalTabId)
			: undefined
	);
	const saveTargetTab = $derived(
		pendingSaveTabId
			? queryTabs.find((tab) => tab.id === pendingSaveTabId)
			: comparisonOriginalTab && comparisonModifiedTab
				? tabComparisonState.focusedComparisonSide === 'left'
					? comparisonOriginalTab
					: comparisonModifiedTab
				: activeQueryTab
	);
	const saveTargetSavedQuery = $derived(
		saveTargetTab?.savedQueryId
			? savedQueryStore.queries.find((query) => query.id === saveTargetTab.savedQueryId)
			: undefined
	);
	const isSaveTargetSavedQueryDirty = $derived(
		Boolean(
			saveTargetTab &&
			saveTargetSavedQuery &&
			(saveTargetTab.database !== saveTargetSavedQuery.database ||
				saveTargetTab.query.trim() !== saveTargetSavedQuery.query)
		)
	);
	const activeCluster = $derived(clusters.find((cluster) => cluster.id === activeClusterId));
	const activeRuntime = $derived(
		activeCluster ? createConnectionRuntime(activeCluster) : undefined
	);
	const activeCapabilities = $derived(
		activeRuntime?.capabilities ?? getConnectionCapabilities(undefined)
	);
	const isMockCluster = $derived(activeCluster?.kind === 'mock');
	const isEmulatedCluster = $derived(activeCluster?.kind === 'emulated');
	const isLogAnalyticsCluster = $derived(activeCluster?.kind === 'log-analytics');
	const isSelectedLogAnalyticsCluster = $derived(
		clusters.find((cluster) => cluster.id === selectedClusterId)?.kind === 'log-analytics'
	);
	const hasBuiltInMockSamples = $derived(usesBuiltInMockCatalog(activeCluster));
	let explorerExpansion = $state(clusterSession.getExplorerExpansion(initialCluster.id));
	const isQueryable = $derived(hasCluster && activeCapabilities.queryExecutor !== 'none');
	const queryExecution = createQueryExecutionController({
		state: executionState,
		recentQueries: recentQueryStore,
		getActiveTab: () => activeQueryTab,
		getActiveClusterId: () => activeClusterId,
		getSelectedDatabase: () => selectedDatabase,
		getRuntime: () => activeRuntime,
		canExecute: () => activeCapabilities.queryExecutor !== 'none',
		getDiagnostics: () => editorComponent?.getDiagnostics() ?? [],
		updateTab: (tabId, update) => clusterSession.updateQueryTab(tabId, update)
	});
	const connectionLifecycle = createConnectionLifecycleController({
		store: clusterConnectionStore,
		session: clusterSession,
		initialCluster,
		onQueryExecutionReset: () => queryExecution.reset(),
		onSchemaReady: (database, pendingQuery) => {
			const tab = activeQueryTab ?? clusterSession.createQueryTab(database);
			clusterSession.updateQueryTab(tab.id, {
				database,
				query: pendingQuery ?? tab.query
			});
			loadQueryTab(clusterSession.getQueryTab(tab.id) ?? tab);
			executionState.result = undefined;
			executionState.error = '';
		},
		onstatechange: () => syncConnectionState()
	});
	const queryTabsController = createQueryTabController({
		state: tabComparisonState,
		session: clusterSession,
		savedQueries: savedQueryStore,
		getSelectedDatabase: () => selectedDatabase,
		setSelectedDatabase: (database) => (selectedDatabase = database),
		clearSchemaSelection: () => {
			selectedTable = undefined;
			selectedFunction = undefined;
		},
		onTabLoaded: (tab) => loadQueryTab(tab),
		onTabClosing: (tabId) => queryExecution.cancelTab(tabId)
	});
	const canSaveTargetQuery = $derived(
		Boolean(saveTargetTab?.query.trim() && saveTargetTab.database)
	);
	const selectedClusterName = $derived(
		clusters.find((cluster) => cluster.id === selectedClusterId)?.name ?? 'selected cluster'
	);
	const activeClusterName = $derived(
		clusters.find((cluster) => cluster.id === activeClusterId)?.name ?? 'current cluster'
	);
	const failedClusterName = $derived(
		clusters.find((cluster) => cluster.id === failedClusterId)?.name ?? 'selected cluster'
	);
	const connectionStatistics = $derived.by(() => {
		const databases = Object.values(databaseSchema ?? {});
		return {
			databaseCount: databases.length,
			tableCount: databases.reduce((count, database) => count + database.tables.length, 0),
			functionCount: databases.reduce(
				(count, database) => count + (database.functions?.length ?? 0),
				0
			)
		};
	});
	const editorTheme = $derived(mode.current === 'dark' ? 'vs-dark' : 'vs');
	const storedRecentQueries = $derived<ExplorerQuery[]>(
		recentQueryStore.forCluster(activeClusterId)
	);
	const recentQueries = $derived<ExplorerQuery[]>(
		storedRecentQueries.length
			? storedRecentQueries
			: hasBuiltInMockSamples
				? MOCK_RECENT_QUERIES
				: []
	);
	const savedQueries = $derived<ExplorerQuery[]>([
		...(hasBuiltInMockSamples ? MOCK_SAVED_QUERIES : []),
		...savedQueryStore.forCluster(activeClusterId)
	]);

	$effect(() => {
		clusterSession.selectedDatabase = selectedDatabase;
		clusterSession.selectedTable = selectedTable;
		clusterSession.selectedFunction = selectedFunction;
	});

	$effect(() => {
		const tab = activeQueryTab;
		if (tab && tab.database !== selectedDatabase) {
			clusterSession.updateQueryTab(tab.id, { database: selectedDatabase });
		}
	});

	$effect(() => {
		if (
			tabComparisonState.comparisonOriginalTabId &&
			(!comparisonOriginalTab ||
				!tabComparisonState.comparisonModifiedTabId ||
				!comparisonModifiedTab)
		) {
			stopQueryComparison();
		}
	});

	$effect(() => {
		if (!saveQueryDialogOpen) pendingSaveTabId = undefined;
	});

	$effect(() => {
		const tabCount = queryTabs.length;
		const tabList = queryTabList;
		if (!tabList) return;
		void tabCount;

		const updateOverflow = () => {
			queryTabListCanScrollLeft = tabList.scrollLeft > 0;
			queryTabListCanScrollRight =
				tabList.scrollLeft + tabList.clientWidth < tabList.scrollWidth - 1;
		};
		const resizeObserver = new ResizeObserver(updateOverflow);
		resizeObserver.observe(tabList);
		tabList.addEventListener('scroll', updateOverflow);
		updateOverflow();

		return () => {
			resizeObserver.disconnect();
			tabList.removeEventListener('scroll', updateOverflow);
		};
	});

	// Schema mutations can be made from the Admin workspace while this editor is
	// mounted. Keep the local snapshot (and therefore Monaco's schema prop) in
	// sync with the app-wide session so completion never uses stale table metadata.
	$effect(() => {
		const sessionSchema = clusterSession.databaseSchema;
		if (databaseSchema !== sessionSchema) databaseSchema = sessionSchema;
	});

	$effect(() => {
		explorerExpansion = clusterSession.getExplorerExpansion(activeClusterId);
	});

	$effect(() => {
		if (!isEmulatedCluster) disposeKqlTranslator();
	});

	function clearLogAnalyticsSignInTip() {
		if (logAnalyticsSignInTipTimeout !== undefined) {
			window.clearTimeout(logAnalyticsSignInTipTimeout);
			logAnalyticsSignInTipTimeout = undefined;
		}
		showLogAnalyticsSignInTip = false;
	}

	function getQueryTabTitle(tab: QueryTab) {
		return queryTabsController.titleFor(tab);
	}

	function loadQueryTab(tab: QueryTab) {
		clusterSession.activeQueryTabId = tab.id;
		if (tab.database && databaseSchema?.[tab.database]) selectedDatabase = tab.database;
		selectedTable = undefined;
		selectedFunction = undefined;
		queryExecution.loadTab(tab);
		requestAnimationFrame(() => {
			queryTabList
				?.querySelector<HTMLElement>(`[data-query-tab-id="${tab.id}"]`)
				?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
		});
	}

	function createQueryTab(
		database = selectedDatabase,
		query = '',
		savedQuery?: Pick<QueryTab, 'savedQueryId' | 'savedQueryName'>
	) {
		queryTabsController.create(database, query, savedQuery);
	}

	function startQueryComparison() {
		queryTabsController.startComparison();
	}

	function compareWithQueryTab(tab: QueryTab) {
		queryTabsController.compareWith(tab);
	}

	function selectQueryTab(tab: QueryTab) {
		queryTabsController.select(tab);
	}

	function stopQueryComparison() {
		queryTabsController.stopComparison();
	}

	function updateActiveQuery(value: string) {
		queryExecution.updateQuery(value);
	}

	function updateComparisonModifiedQuery(value: string) {
		if (!comparisonModifiedTab) return;
		queryTabsController.updateComparisonQuery('right', value);
		if (comparisonModifiedTab.id === activeQueryTabId) executionState.queryText = value;
	}

	function updateComparisonOriginalQuery(value: string) {
		if (!comparisonOriginalTab) return;
		queryTabsController.updateComparisonQuery('left', value);
		if (comparisonOriginalTab.id === activeQueryTabId) executionState.queryText = value;
	}

	async function runComparisonQuery(side = tabComparisonState.focusedComparisonSide) {
		const tab = side === 'left' ? comparisonOriginalTab : comparisonModifiedTab;
		if (!tab) return;
		if (tab.id !== activeQueryTabId) {
			loadQueryTab(tab);
			await tick();
		}
		await runQuery();
	}

	function isQueryTabDirty(tab: QueryTab) {
		return queryTabsController.isDirty(tab);
	}

	function closeQueryTab(tab: QueryTab) {
		queryTabsController.close(tab);
	}

	function scrollQueryTabsWithWheel(event: WheelEvent) {
		if (!queryTabList || queryTabList.scrollWidth <= queryTabList.clientWidth) return;
		const distance = event.deltaX || event.deltaY;
		if (!distance) return;
		event.preventDefault();
		queryTabList.scrollBy({ left: distance });
	}

	function scrollQueryTabs(direction: 'left' | 'right') {
		if (!queryTabList) return;
		queryTabList.scrollBy({
			left: queryTabList.clientWidth * 0.65 * (direction === 'left' ? -1 : 1),
			behavior: 'smooth'
		});
	}

	function startQueryTabDrag(event: PointerEvent) {
		if (
			event.button !== 0 ||
			!queryTabList ||
			queryTabList.scrollWidth <= queryTabList.clientWidth
		) {
			return;
		}
		queryTabDragPointerId = event.pointerId;
		queryTabDragStartX = event.clientX;
		queryTabDragStartScrollLeft = queryTabList.scrollLeft;
		queryTabList.setPointerCapture(event.pointerId);
	}

	function dragQueryTabs(event: PointerEvent) {
		if (event.pointerId !== queryTabDragPointerId || !queryTabList) return;
		const distance = event.clientX - queryTabDragStartX;
		if (Math.abs(distance) > 3) ignoreQueryTabClick = true;
		queryTabList.scrollLeft = queryTabDragStartScrollLeft - distance;
	}

	function stopQueryTabDrag(event: PointerEvent) {
		if (event.pointerId !== queryTabDragPointerId || !queryTabList) return;
		queryTabList.releasePointerCapture(event.pointerId);
		queryTabDragPointerId = undefined;
		if (ignoreQueryTabClick) {
			window.setTimeout(() => {
				ignoreQueryTabClick = false;
			});
		}
	}

	function scheduleLogAnalyticsSignInTip(requestId: number, clusterId: string) {
		clearLogAnalyticsSignInTip();
		logAnalyticsSignInTipTimeout = window.setTimeout(() => {
			logAnalyticsSignInTipTimeout = undefined;
			if (
				requestId === schemaRequestId &&
				clusterId === selectedClusterId &&
				connectionStatus === 'loading'
			) {
				showLogAnalyticsSignInTip = true;
			}
		}, LOG_ANALYTICS_SIGN_IN_TIP_DELAY_MS);
	}

	function syncConnectionState() {
		const state = connectionLifecycle.state;
		databaseSchema = state.databaseSchema;
		connectionStatus = state.connectionStatus;
		isClusterSwitching = state.isClusterSwitching;
		showLogAnalyticsSignInTip = state.showLogAnalyticsSignInTip;
		connectionError = state.connectionError;
		failedClusterId = state.failedClusterId;
		selectedDatabase = state.selectedDatabase;
		selectedTable = state.selectedTable;
		selectedFunction = state.selectedFunction;
		activeClusterId = state.activeClusterId;
		activeClusterUrl = state.activeClusterUrl;
		selectedClusterId = state.selectedClusterId;
	}

	async function refreshSchema() {
		const state = connectionLifecycle.state;
		state.selectedClusterId = selectedClusterId;
		state.selectedDatabase = selectedDatabase;
		state.selectedTable = selectedTable;
		state.selectedFunction = selectedFunction;
		await connectionLifecycle.refresh();
		syncConnectionState();
	}

	function switchCluster(clusterId: string) {
		if (clusterId === selectedClusterId) return;
		connectionLifecycle.switchCluster(clusterId);
		syncConnectionState();
	}

	function addCluster(draft: NewClusterConnection) {
		connectionLifecycle.addCluster(draft);
		syncConnectionState();
	}

	function editCluster(clusterId: string, draft: NewClusterConnection) {
		connectionLifecycle.editCluster(clusterId, draft);
		syncConnectionState();
	}

	async function removeCluster(clusterId: string) {
		await connectionLifecycle.removeCluster(clusterId);
		syncConnectionState();
	}

	function retryFailedCluster() {
		connectionLifecycle.retry();
		syncConnectionState();
	}

	function dismissConnectionFailure() {
		connectionLifecycle.dismissFailure();
		syncConnectionState();
	}

	function loadRecentQuery(query: ExplorerQuery) {
		const savedQuery = query.id
			? savedQueryStore.queries.find(
					(candidate) => candidate.id === query.id && candidate.clusterId === activeClusterId
				)
			: undefined;
		const existingTab = savedQuery
			? queryTabs.find((tab) => tab.savedQueryId === savedQuery.id)
			: undefined;
		if (existingTab) {
			loadQueryTab(existingTab);
			return;
		}
		createQueryTab(
			query.database,
			query.query,
			savedQuery ? { savedQueryId: savedQuery.id, savedQueryName: savedQuery.name } : undefined
		);
	}

	function openQuery(query: ExplorerQuery) {
		if (view === 'editor') {
			loadRecentQuery(query);
			return;
		}

		clusterSession.selectedDatabase = query.database;
		clusterSession.selectedTable = undefined;
		clusterSession.selectedFunction = undefined;
		const savedQuery = query.id
			? savedQueryStore.queries.find(
					(candidate) => candidate.id === query.id && candidate.clusterId === activeClusterId
				)
			: undefined;
		const existingTab = savedQuery
			? queryTabs.find((tab) => tab.savedQueryId === savedQuery.id)
			: undefined;
		if (existingTab) {
			clusterSession.activeQueryTabId = existingTab.id;
			clusterSession.pendingQuery = undefined;
		} else {
			clusterSession.pendingQuery = query.query;
			clusterSession.createQueryTab(
				query.database,
				query.query,
				savedQuery ? { savedQueryId: savedQuery.id, savedQueryName: savedQuery.name } : undefined
			);
		}
		void goto('/explorer/query');
	}

	function openExplorerSelection(selection: ExplorerSelection) {
		if (view === 'editor') return;
		clusterSession.selectedDatabase = selection.database;
		clusterSession.selectedTable = selection.table;
		clusterSession.selectedFunction = selection.function;
		void goto('/explorer/query');
	}

	function deleteSavedQuery(query: ExplorerQuery) {
		if (query.id) savedQueryStore.remove(query.id);
	}

	function deleteRecentQuery(query: ExplorerQuery) {
		if (query.id) recentQueryStore.remove(query.id);
	}

	function updateExplorerExpansion(
		change: import('$lib/cluster/cluster-session.svelte').ExplorerExpansionChange
	) {
		clusterSession.setExplorerExpansion(activeClusterId, change);
	}

	function openSaveQueryDialog(tab: QueryTab) {
		if (!tab.query.trim() || !tab.database) return;
		pendingSaveTabId = tab.id;
		savedQueryName = '';
		savedQueryNameError = '';
		saveQueryDialogOpen = true;
	}

	function saveQuery(tab = saveTargetTab) {
		if (!tab) return;
		const query = tab.query.trim();
		if (!query || !tab.database) return;
		const savedQuery = tab.savedQueryId
			? savedQueryStore.queries.find((candidate) => candidate.id === tab.savedQueryId)
			: undefined;
		if (!savedQuery) {
			openSaveQueryDialog(tab);
			return;
		}

		const updatedQuery = savedQueryStore.update(savedQuery.id, {
			clusterId: activeClusterId,
			database: tab.database,
			name: savedQuery.name,
			query
		});
		if (!updatedQuery) return;

		clusterSession.updateQueryTab(tab.id, {
			savedQueryName: updatedQuery.name,
			query: updatedQuery.query,
			database: updatedQuery.database
		});
		if (tab.id === activeQueryTabId) executionState.queryText = updatedQuery.query;
	}

	function saveCurrentQuery() {
		const tab = saveTargetTab;
		if (!tab) return;
		const query = tab.query.trim();
		if (!query || !tab.database) return;

		const name = savedQueryName.trim();
		if (!name) {
			savedQueryNameError = 'Enter a name for this query.';
			return;
		}

		const savedQuery = savedQueryStore.save({
			clusterId: activeClusterId,
			database: tab.database,
			name,
			query
		});
		clusterSession.updateQueryTab(tab.id, {
			savedQueryId: savedQuery.id,
			savedQueryName: savedQuery.name,
			query: savedQuery.query
		});
		if (tab.id === activeQueryTabId) executionState.queryText = savedQuery.query;
		saveQueryDialogOpen = false;
		pendingSaveTabId = undefined;
	}

	function preventRefreshWithQuery(event: BeforeUnloadEvent) {
		if (!queryTabs.some(isQueryTabDirty)) return;
		event.preventDefault();
		event.returnValue = '';
	}

	async function runQuery() {
		await queryExecution.run();
	}

	function cancelQuery() {
		queryExecution.cancel();
	}

	function setResultsCollapsed(collapsed: boolean) {
		executionState.resultsCollapsed = collapsed;
		if (collapsed) {
			resultsPane?.collapse();
		} else {
			resultsPane?.expand();
		}
	}

	function toggleDatabaseSchema() {
		if (databaseSchemaCollapsed) {
			databaseSchemaPane?.expand();
		} else {
			databaseSchemaPane?.collapse();
		}
	}

	$effect(() => {
		if (!clusterConnectionStore.hydrated || hasInitializedConnection) return;
		hasInitializedConnection = true;
		const persistedClusterId = getPersistedActiveClusterId();
		if (
			!clusterSession.databaseSchema &&
			persistedClusterId &&
			clusters.some((cluster) => cluster.id === persistedClusterId)
		) {
			selectedClusterId = persistedClusterId;
		}
		if (
			!clusterSession.isSchemaFresh(
				selectedClusterId,
				isSelectedLogAnalyticsCluster ? LOG_ANALYTICS_SCHEMA_TTL_MS : Number.POSITIVE_INFINITY
			)
		) {
			void refreshSchema();
		}
	});

	onMount(() => {
		window.addEventListener('beforeunload', preventRefreshWithQuery);
		return () => {
			schemaRequestId += 1;
			clearLogAnalyticsSignInTip();
			queryExecution.dispose();
			disposeKqlTranslator();
			window.removeEventListener('beforeunload', preventRefreshWithQuery);
		};
	});
</script>

<svelte:head>
	<title>Kite</title>
</svelte:head>

{#snippet sidebarHeader()}
	<ClusterConnectionSelector
		{clusters}
		{customClusters}
		{selectedClusterId}
		disabled={isClusterSwitching}
		switching={isClusterSwitching}
		onclusterchange={switchCluster}
		onclusteradd={addCluster}
		onclusteredit={editCluster}
		onclusterremove={removeCluster}
		onlinkauthenticationprofile={(clusterId, authenticationProfileId) => {
			clusterConnectionStore.linkLogAnalyticsAuthenticationProfile(
				clusterId,
				authenticationProfileId
			);
			switchCluster(clusterId);
		}}
	/>
{/snippet}

{#snippet sidebarContent()}
	<DatabaseExplorer
		databases={databaseSchema ?? {}}
		{connectionStatus}
		showCluster={hasCluster}
		clusterDisabled={isClusterSwitching}
		bind:selectedDatabase
		bind:selectedTable
		bind:selectedFunction
		expansionState={explorerExpansion}
		onexpansionchange={updateExplorerExpansion}
		{recentQueries}
		{savedQueries}
		bind:filter={explorerFilter}
		onqueryselect={openQuery}
		onselectionchange={view === 'editor' ? undefined : openExplorerSelection}
		onsavedquerydelete={deleteSavedQuery}
		onrecentquerydelete={deleteRecentQuery}
	/>
{/snippet}

<AppShell {sidebarHeader} {sidebarContent}>
	<AppHeader
		breadcrumbs={view === 'overview'
			? [{ label: 'Kite', href: '/' }, { label: 'Explorer' }]
			: view === 'editor'
				? [
						{ label: 'Kite', href: '/' },
						{ label: 'Explorer', href: '/explorer' },
						{ label: 'Query' }
					]
				: [
						{ label: 'Kite', href: '/' },
						{ label: 'Explorer', href: '/explorer' },
						{ label: 'Query', href: '/explorer/query' },
						{ label: 'Saved queries' }
					]}
		title=""
		sidebarToggleLabel="Toggle cluster explorer"
	/>

	{#if view === 'overview'}
		{#if explorerHeroModule}
			{#await explorerHeroModule}
				<div class="grid min-h-48 flex-1 place-items-center" aria-label="Loading Explorer overview">
					<Spinner />
				</div>
			{:then module}
				<module.default
					clusterName={activeClusterName}
					databaseCount={connectionStatistics.databaseCount}
					tableCount={connectionStatistics.tableCount}
					functionCount={connectionStatistics.functionCount}
					databases={databaseSchema ?? {}}
					{recentQueries}
					{savedQueries}
					emulatedStorage={activeCluster?.emulatedStorage}
					onqueryopen={openQuery}
					onselectionopen={openExplorerSelection}
				/>
			{/await}
		{/if}
	{:else if view === 'saved-queries'}
		{#if savedQueriesPageModule}
			{#await savedQueriesPageModule}
				<div class="grid min-h-48 flex-1 place-items-center" aria-label="Loading saved queries">
					<Spinner />
				</div>
			{:then module}
				<module.default queries={savedQueries} onopen={openQuery} delete={deleteSavedQuery} />
			{/await}
		{/if}
	{:else}
		{#if monacoEditorModule && queryResultsModule && databaseSchemaModule}
			{#await Promise.all([monacoEditorModule, queryResultsModule, databaseSchemaModule])}
				<div class="grid min-h-48 flex-1 place-items-center" aria-label="Loading query workspace">
					<Spinner />
				</div>
			{:then [monacoModule, resultsModule, schemaModule]}
				<Resizable.PaneGroup
					direction="horizontal"
					autoSaveId="kite-cluster-layout"
					class="min-h-0 flex-1 overflow-hidden bg-muted/20 shadow-xs"
				>
					{#if databaseSchema}
						<Resizable.Pane defaultSize={75} minSize={45}>
							<div class="relative h-full min-h-0">
								<Resizable.PaneGroup
									direction="vertical"
									autoSaveId="kite-query-layout"
									class="min-h-0"
								>
									<Resizable.Pane defaultSize={66} minSize={25}>
										<div
											class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card"
											aria-busy={isClusterSwitching}
										>
											<div class="flex h-9 shrink-0 items-stretch border-b bg-card">
												<div class="relative min-w-0 flex-1">
													<div
														bind:this={queryTabList}
														class:cursor-grabbing={queryTabDragPointerId !== undefined}
														class="flex h-full min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
														role="tablist"
														aria-label="Query tabs"
														tabindex="0"
														onwheel={scrollQueryTabsWithWheel}
														onpointerdown={startQueryTabDrag}
														onpointermove={dragQueryTabs}
														onpointerup={stopQueryTabDrag}
														onpointercancel={stopQueryTabDrag}
													>
														{#each queryTabs as tab (tab.id)}
															{@const isComparedTab = Boolean(
																comparisonOriginalTab && tab.id === comparisonOriginalTab.id
															)}
															{@const isComparisonModifiedTab = Boolean(
																comparisonOriginalTab && tab.id === comparisonModifiedTab?.id
															)}
															{@const isQueryTabLocked = Boolean(
																comparisonOriginalTab &&
																comparisonModifiedTab &&
																tab.id !== comparisonOriginalTab.id &&
																tab.id !== comparisonModifiedTab.id
															)}
															<div
																data-query-tab-id={tab.id}
																class="group flex h-full min-w-0 shrink-0 items-center border-r border-t-2 border-t-transparent px-2 text-xs transition-colors {tab.id ===
																activeQueryTabId
																	? 'border-t-primary bg-primary/10 text-foreground'
																	: isComparisonModifiedTab
																		? 'border-t-primary/70 bg-primary/10 text-foreground'
																		: isComparedTab
																			? 'border-t-amber-500/70 bg-amber-500/10 text-foreground'
																			: isQueryTabLocked
																				? 'cursor-not-allowed text-muted-foreground opacity-50'
																				: 'text-muted-foreground hover:bg-muted'}"
																role="tab"
																aria-selected={tab.id === activeQueryTabId}
																aria-disabled={isQueryTabLocked}
																aria-label={`${getQueryTabTitle(tab)}${isComparedTab ? ', comparison original' : isComparisonModifiedTab ? ', comparison modified' : ''}`}
															>
																<button
																	type="button"
																	class="flex h-full max-w-32 min-w-0 items-center text-left outline-none"
																	disabled={isQueryTabLocked}
																	onclick={(event) => {
																		if (ignoreQueryTabClick) return;
																		if (event.shiftKey) {
																			compareWithQueryTab(tab);
																			return;
																		}
																		selectQueryTab(tab);
																	}}
																	title={isQueryTabLocked
																		? 'Close diff to select this query'
																		: `${getQueryTabTitle(tab)}${
																				activeQueryTab &&
																				tab.id !== activeQueryTab.id &&
																				tab.database.trim().toLowerCase() ===
																					activeQueryTab.database.trim().toLowerCase()
																					? ' (Shift-click to compare)'
																					: ''
																			}`}
																>
																	{#if isQueryTabDirty(tab)}
																		<span
																			class="bg-primary mr-1 inline-block size-1.5 shrink-0 rounded-full"
																			aria-hidden="true"
																		></span>
																		<span class="sr-only">Unsaved changes </span>
																	{/if}
																	<span class="min-w-0 truncate">{getQueryTabTitle(tab)}</span>
																</button>
																<Button
																	variant="ghost"
																	size="icon-xs"
																	class="-mr-1 size-6 rounded-none opacity-60 group-hover:opacity-100"
																	aria-label={`Close ${getQueryTabTitle(tab)}`}
																	onpointerdown={(event) => event.stopPropagation()}
																	onclick={(event) => {
																		event.stopPropagation();
																		closeQueryTab(tab);
																	}}
																>
																	<XIcon />
																</Button>
															</div>
														{/each}
													</div>
													{#if queryTabListCanScrollLeft}
														<Button
															variant="ghost"
															size="icon-sm"
															class="absolute inset-y-0 left-0 z-10 h-full w-8 rounded-none border-0 border-r bg-card"
															aria-label="Show earlier query tabs"
															title="Show earlier query tabs"
															onpointerdown={(event) => event.stopPropagation()}
															onclick={() => scrollQueryTabs('left')}
														>
															<ChevronLeftIcon />
														</Button>
													{/if}
													{#if queryTabListCanScrollRight}
														<Button
															variant="ghost"
															size="icon-sm"
															class="absolute inset-y-0 right-0 z-10 h-full w-8 rounded-none border-0 border-l bg-card"
															aria-label="Show later query tabs"
															title="Show later query tabs"
															onpointerdown={(event) => event.stopPropagation()}
															onclick={() => scrollQueryTabs('right')}
														>
															<ChevronRightIcon />
														</Button>
													{/if}
												</div>
												<div class="flex shrink-0 items-stretch border-l bg-card">
													<Button
														variant="ghost"
														size="icon-sm"
														class="h-full w-9 rounded-none border-0 border-r"
														aria-label="New query tab"
														onclick={() => createQueryTab()}
													>
														<PlusIcon />
													</Button>
													<Button
														variant="ghost"
														size="icon-sm"
														class="h-full w-9 rounded-none border-0 border-r"
														aria-label={databaseSchemaCollapsed
															? 'Show database schema'
															: 'Hide database schema'}
														title={databaseSchemaCollapsed
															? 'Show database schema'
															: 'Hide database schema'}
														onclick={toggleDatabaseSchema}
													>
														{#if databaseSchemaCollapsed}
															<PanelRightOpenIcon />
														{:else}
															<PanelRightCloseIcon />
														{/if}
													</Button>

													<Button
														variant="outline"
														size="sm"
														class="h-full rounded-none border-0 border-r px-2.5 shadow-none"
														disabled={!comparisonOriginalTab && !compareCandidates.length}
														onclick={comparisonOriginalTab
															? stopQueryComparison
															: startQueryComparison}
														title={comparisonOriginalTab
															? 'Close query comparison'
															: compareCandidates.length
																? 'Compare with another query in this database'
																: 'Open another query tab for this database to compare queries'}
													>
														<ArrowLeftRightIcon />
														{comparisonOriginalTab ? 'Close diff' : 'Compare'}
													</Button>
													<Button
														variant="outline"
														size="sm"
														class="h-full rounded-none border-0 border-r px-2.5 shadow-none"
														disabled={!canSaveTargetQuery ||
															Boolean(saveTargetSavedQuery && !isSaveTargetSavedQueryDirty)}
														onclick={() => saveQuery()}
														title={saveTargetSavedQuery
															? isSaveTargetSavedQueryDirty
																? `Update ${saveTargetSavedQuery.name}`
																: 'No saved-query changes'
															: 'Save query locally'}
													>
														<BookmarkPlusIcon />
														Save
													</Button>
													{#if executionState.isRunning}
														<Button
															variant="outline"
															size="sm"
															class="h-full rounded-none border-0 border-r px-2.5 shadow-none"
															onclick={cancelQuery}
														>
															<CircleStopIcon />
															Cancel
														</Button>
													{:else}
														<Separator orientation="vertical" />
														<Button
															size="sm"
															class="h-full rounded-none border-0 px-3 shadow-none"
															onclick={() =>
																void (comparisonOriginalTab && comparisonModifiedTab
																	? runComparisonQuery()
																	: runQuery())}
															disabled={!(comparisonOriginalTab && comparisonModifiedTab
																? tabComparisonState.focusedComparisonSide === 'left'
																	? comparisonOriginalTab.query.trim()
																	: comparisonModifiedTab.query.trim()
																: executionState.queryText.trim()) || !isQueryable}
															title={isMockCluster
																? 'Query execution is unavailable for the mock cluster'
																: 'Run query (Shift+Enter)'}
															aria-keyshortcuts={isQueryable ? 'Shift+Enter' : undefined}
														>
															<PlayIcon />
															Run
														</Button>
													{/if}
												</div>
											</div>

											{#if comparisonOriginalTab && comparisonModifiedTab}
												<section class="flex min-h-0 flex-1 flex-col" aria-label="Query comparison">
													<div
														class="flex h-10 shrink-0 items-center gap-3 border-b bg-muted/20 px-3 text-xs"
													>
														<div class="flex min-w-0 flex-1 items-center gap-2">
															<span
																class="hidden shrink-0 font-medium text-muted-foreground sm:inline"
																>Diff</span
															>
															<span class="hidden shrink-0 text-muted-foreground md:inline"
																>Reference</span
															>
															<label class="sr-only" for="comparison-original-tab"
																>Reference query</label
															>
															<Select.Root
																type="single"
																bind:value={tabComparisonState.comparisonOriginalTabId}
															>
																<Select.Trigger
																	id="comparison-original-tab"
																	size="sm"
																	class="max-w-44"
																>
																	<span data-slot="select-value" class="min-w-0 truncate">
																		{comparisonOriginalTab
																			? getQueryTabTitle(comparisonOriginalTab)
																			: 'Choose reference query'}
																	</span>
																</Select.Trigger>
																<Select.Content>
																	<Select.Group>
																		{#each compareCandidates as tab (tab.id)}
																			<Select.Item value={tab.id} label={getQueryTabTitle(tab)} />
																		{/each}
																	</Select.Group>
																</Select.Content>
															</Select.Root>
															<ArrowRightIcon class="shrink-0 text-muted-foreground" />
															<span class="hidden shrink-0 text-muted-foreground md:inline"
																>Current</span
															>
															<span
																class="max-w-44 truncate rounded-sm bg-primary/10 px-1.5 py-1 font-medium text-foreground ring-1 ring-primary/30"
																title={getQueryTabTitle(comparisonModifiedTab)}
																>{getQueryTabTitle(comparisonModifiedTab)}</span
															>
														</div>
														<div
															class="hidden shrink-0 border-l pl-3 font-mono text-muted-foreground lg:block"
															title={comparisonModifiedTab.database}
														>
															DB: {comparisonModifiedTab.database}
														</div>
													</div>
													{#key `${comparisonModifiedTab.id}:${comparisonOriginalTab.id}`}
														<monacoModule.default
															bind:this={editorComponent}
															value={comparisonModifiedTab.query}
															originalValue={comparisonOriginalTab.query}
															class="min-h-0 flex-1"
															database={comparisonModifiedTab.database}
															height="100%"
															{databaseSchema}
															clusterUrl={activeClusterUrl}
															theme={editorTheme}
															syncValue={false}
															onexecute={(side) => void runComparisonQuery(side)}
															onvaluechange={updateComparisonModifiedQuery}
															onoriginalvaluechange={updateComparisonOriginalQuery}
															onactivesidechange={(side) =>
																(tabComparisonState.focusedComparisonSide = side)}
															onlanguagestatuschange={(status) => (languageServiceStatus = status)}
														/>
													{/key}
												</section>
											{:else}
												{#key activeQueryTabId}
													<monacoModule.default
														bind:this={editorComponent}
														value={executionState.queryText}
														class="min-h-0 flex-1"
														database={selectedDatabase}
														height="100%"
														{databaseSchema}
														clusterUrl={activeClusterUrl}
														theme={editorTheme}
														syncValue={false}
														onexecute={() => void runQuery()}
														onvaluechange={updateActiveQuery}
														onlanguagestatuschange={(status) => (languageServiceStatus = status)}
													/>
												{/key}
											{/if}

											{#if isClusterSwitching}
												<div
													class="absolute inset-0 z-20 grid place-items-center bg-background/70 backdrop-blur-[1px]"
												>
													<div
														class="text-muted-foreground flex flex-col items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs shadow-sm"
													>
														<Spinner class="size-4" />
														<span>Switching to {selectedClusterName}…</span>
														{#if isSelectedLogAnalyticsCluster && showLogAnalyticsSignInTip}
															<div
																class="flex max-w-xs items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-left text-xs"
															>
																<LightbulbIcon class="mt-0.5 size-3.5 shrink-0 text-primary" />
																<p>
																	<span class="font-medium">Tip:</span> Check for the Microsoft Entra
																	sign-in pop-up to continue.
																</p>
															</div>
														{/if}
													</div>
												</div>
											{/if}
										</div>
									</Resizable.Pane>

									<Resizable.Handle />

									<Resizable.Pane
										bind:this={resultsPane}
										defaultSize={34}
										minSize={5}
										collapsible
										collapsedSize={5}
										onCollapse={() => (executionState.resultsCollapsed = true)}
										onExpand={() => (executionState.resultsCollapsed = false)}
									>
										<resultsModule.default
											class="h-full min-h-0 rounded-none border-0"
											result={executionState.result}
											error={executionState.error}
											errorRequestId={executionState.errorRequestId}
											errorRaw={executionState.errorRaw}
											isRunning={executionState.isRunning}
											collapsed={executionState.resultsCollapsed}
											oncollapsedchange={setResultsCollapsed}
										/>
									</Resizable.Pane>
								</Resizable.PaneGroup>
							</div>
						</Resizable.Pane>

						<Resizable.Handle
							class={databaseSchemaCollapsed ? 'invisible pointer-events-none' : undefined}
							tabindex={databaseSchemaCollapsed ? -1 : 0}
						/>

						<Resizable.Pane
							bind:this={databaseSchemaPane}
							defaultSize={25}
							minSize={15}
							maxSize={40}
							collapsible
							collapsedSize={0}
							onCollapse={() => (databaseSchemaCollapsed = true)}
							onExpand={() => (databaseSchemaCollapsed = false)}
						>
							<schemaModule.default
								class={isClusterSwitching
									? 'pointer-events-none h-full min-h-0 rounded-none border-0 opacity-60 shadow-none'
									: 'h-full min-h-0 rounded-none border-0 shadow-none'}
								database={databaseSchema[selectedDatabase]}
								expansionState={explorerExpansion}
								onexpansionchange={updateExplorerExpansion}
								bind:selectedTable
								bind:selectedFunction
								height="100%"
							/>
						</Resizable.Pane>
					{:else}
						<Resizable.Pane defaultSize={82} minSize={35}>
							<section
								class="flex h-full min-h-0 items-center justify-center bg-background p-6"
								aria-live="polite"
							>
								{#if connectionStatus === 'loading'}
									<div class="text-muted-foreground flex flex-col items-center gap-3 text-sm">
										<Spinner class="size-6" />
										<p>Connecting to {selectedClusterName}…</p>
										{#if isSelectedLogAnalyticsCluster && showLogAnalyticsSignInTip}
											<div
												class="flex max-w-sm items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-left text-xs"
											>
												<LightbulbIcon class="mt-0.5 size-4 shrink-0 text-primary" />
												<p>
													<span class="font-medium">Tip:</span> Check for potential Microsoft Entra sign-in
													pop-up to continue.
												</p>
											</div>
										{/if}
									</div>
								{:else}
									<div class="max-w-md text-center">
										<h2 class="font-semibold">Could not connect to Kusto</h2>
										<p class="text-muted-foreground mt-2 text-sm">{connectionError}</p>
										<Button class="mt-4" variant="outline" onclick={() => void refreshSchema()}>
											<RefreshCwIcon />
											Retry
										</Button>
									</div>
								{/if}
							</section>
						</Resizable.Pane>
					{/if}
				</Resizable.PaneGroup>

				<ConnectionStatus
					status={connectionStatus}
					{...connectionStatistics}
					database={selectedDatabase}
					{languageServiceStatus}
					{isQueryable}
					emulatedStorage={activeCluster?.emulatedStorage}
					emulatedResultsWarning={isEmulatedCluster}
					onretry={failedClusterId ? retryFailedCluster : undefined}
				/>
			{/await}
		{/if}
	{/if}

	{#if connectionStatus === 'error' && connectionError && databaseSchema}
		<ConnectionFailureDialog
			{failedClusterName}
			{activeClusterName}
			error={connectionError}
			oncontinue={dismissConnectionFailure}
			onretry={retryFailedCluster}
		/>
	{/if}

	<Dialog.Root bind:open={saveQueryDialogOpen}>
		<Dialog.Content class="gap-0 overflow-hidden" aria-describedby="save-query-dialog-description">
			<form
				onsubmit={(event) => {
					event.preventDefault();
					saveCurrentQuery();
				}}
			>
				<Dialog.Header class="border-b p-5 pr-14">
					<Dialog.Title>Save query</Dialog.Title>
					<Dialog.Description id="save-query-dialog-description">
						Save this query locally for {saveTargetTab?.database} on the current cluster.
					</Dialog.Description>
				</Dialog.Header>

				<div class="p-5">
					<label class="text-sm font-medium" for="saved-query-name">Query name</label>
					<Input
						id="saved-query-name"
						class="mt-2"
						bind:value={savedQueryName}
						aria-invalid={Boolean(savedQueryNameError)}
						aria-describedby={savedQueryNameError ? 'saved-query-name-error' : undefined}
						placeholder="Name for this query"
						autocomplete="off"
					/>
					{#if savedQueryNameError}
						<p id="saved-query-name-error" class="text-destructive mt-2 text-sm" role="alert">
							{savedQueryNameError}
						</p>
					{/if}
				</div>

				<Dialog.Footer class="border-t p-4">
					<Button variant="outline" onclick={() => (saveQueryDialogOpen = false)}>Cancel</Button>
					<Button type="submit">Save query</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>
</AppShell>
