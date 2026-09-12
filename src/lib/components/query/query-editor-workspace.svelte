<script lang="ts">
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import type { PaneAPI } from 'paneforge';

	import type {
		ExplorerExpansionChange,
		ExplorerExpansionState,
		QueryTab
	} from '$lib/cluster/cluster-session.svelte';
	import DatabaseSchema from '$lib/components/cluster/database-schema.svelte';
	import ConnectionStatus from '$lib/components/query/connection-status.svelte';
	import QueryConnectionPlaceholder from '$lib/components/query/query-connection-placeholder.svelte';
	import QueryEditorSurface from '$lib/components/query/query-editor-surface.svelte';
	import QueryResults from '$lib/components/query/query-results.svelte';
	import QueryTabBar from '$lib/components/query/query-tab-bar.svelte';
	import type {
		ConnectionStatistics,
		LanguageServiceStatus,
		QueryWorkspaceExecutionState
	} from '$lib/components/query/query-workspace-types';
	import * as Resizable from '$lib/components/ui/resizable';
	import { Spinner } from '$lib/components/ui/spinner';
	import type { EmulatedStorage } from '$lib/emulation/storage';
	import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

	type QueryEditorWorkspaceProps = {
		databaseSchema?: KustoDatabaseSchema;
		selectedDatabase: string;
		selectedTable?: string;
		selectedFunction?: string;
		explorerExpansion: ExplorerExpansionState;
		activeClusterUrl?: string;
		activeTab?: QueryTab;
		originalTab?: QueryTab;
		modifiedTab?: QueryTab;
		compareCandidates: QueryTab[];
		queryTabs: QueryTab[];
		comparisonOriginalTabId?: string;
		focusedComparisonSide: 'left' | 'right';
		executionState: QueryWorkspaceExecutionState;
		connectionStatus: 'loading' | 'ready' | 'error';
		connectionError: string;
		isClusterSwitching: boolean;
		showLogAnalyticsSignInTip: boolean;
		isSelectedLogAnalyticsCluster: boolean;
		selectedClusterName: string;
		isQueryable: boolean;
		isMockCluster: boolean;
		isEmulatedCluster: boolean;
		emulatedStorage?: EmulatedStorage;
		connectionStatistics: ConnectionStatistics;
		languageServiceStatus: LanguageServiceStatus;
		failedClusterId?: string;
		canSave: boolean;
		saveTitle: string;
		titleFor: (tab: QueryTab) => string;
		isDirty: (tab: QueryTab) => boolean;
		onselecttab: (tab: QueryTab) => void;
		oncomparetab: (tab: QueryTab) => void;
		onclosetab: (tab: QueryTab) => void;
		oncreatetab: () => void;
		onstartcomparison: () => void;
		onstopcomparison: () => void;
		onsave: () => void;
		onrun: () => void;
		onruncomparison: (side?: 'left' | 'right') => void;
		oncancel: () => void;
		onquerychange: (value: string) => void;
		onmodifiedchange: (value: string) => void;
		onoriginalchange: (value: string) => void;
		onexpansionchange: (change: ExplorerExpansionChange) => void;
		onrefresh: () => void;
		onretry: () => void;
		onlanguagestatuschange: (status: LanguageServiceStatus) => void;
		oncomparisonoriginalchange: (tabId: string) => void;
		oncomparisonsidechange: (side: 'left' | 'right') => void;
		onresultscollapsedchange: (collapsed: boolean) => void;
	};

	let {
		databaseSchema,
		selectedDatabase,
		selectedTable = $bindable(),
		selectedFunction = $bindable(),
		explorerExpansion,
		activeClusterUrl,
		activeTab,
		originalTab,
		modifiedTab,
		compareCandidates,
		queryTabs,
		comparisonOriginalTabId,
		focusedComparisonSide,
		executionState,
		connectionStatus,
		connectionError,
		isClusterSwitching,
		showLogAnalyticsSignInTip,
		isSelectedLogAnalyticsCluster,
		selectedClusterName,
		isQueryable,
		isMockCluster,
		isEmulatedCluster,
		emulatedStorage,
		connectionStatistics,
		languageServiceStatus,
		failedClusterId,
		canSave,
		saveTitle,
		titleFor,
		isDirty,
		onselecttab,
		oncomparetab,
		onclosetab,
		oncreatetab,
		onstartcomparison,
		onstopcomparison,
		onsave,
		onrun,
		onruncomparison,
		oncancel,
		onquerychange,
		onmodifiedchange,
		onoriginalchange,
		onexpansionchange,
		onrefresh,
		onretry,
		onlanguagestatuschange,
		oncomparisonoriginalchange,
		oncomparisonsidechange,
		onresultscollapsedchange
	}: QueryEditorWorkspaceProps = $props();

	let resultsPane = $state<PaneAPI>();
	let databaseSchemaPane = $state<PaneAPI>();
	let databaseSchemaCollapsed = $state(false);
	let editorSurface = $state<{
		getDiagnostics: () => import('./monaco-editor.svelte').EditorDiagnostic[];
	}>();
	const canRun = $derived(
		Boolean(
			(originalTab && modifiedTab
				? focusedComparisonSide === 'left'
					? originalTab.query.trim()
					: modifiedTab.query.trim()
				: executionState.queryText.trim()) && isQueryable
		)
	);

	export function getDiagnostics() {
		return editorSurface?.getDiagnostics() ?? [];
	}

	function setResultsCollapsed(collapsed: boolean) {
		onresultscollapsedchange(collapsed);
		if (collapsed) resultsPane?.collapse();
		else resultsPane?.expand();
	}

	function toggleDatabaseSchema() {
		if (databaseSchemaCollapsed) databaseSchemaPane?.expand();
		else databaseSchemaPane?.collapse();
	}
</script>

<Resizable.PaneGroup
	direction="horizontal"
	autoSaveId="kite-cluster-layout"
	class="min-h-0 flex-1 overflow-hidden bg-muted/20 shadow-xs"
>
	{#if databaseSchema}
		<Resizable.Pane defaultSize={75} minSize={45}>
			<div class="relative h-full min-h-0">
				<Resizable.PaneGroup direction="vertical" autoSaveId="kite-query-layout" class="min-h-0">
					<Resizable.Pane defaultSize={66} minSize={25}>
						<div
							class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card"
							aria-busy={isClusterSwitching}
						>
							<QueryTabBar
								tabs={queryTabs}
								{activeTab}
								{originalTab}
								{modifiedTab}
								{compareCandidates}
								schemaCollapsed={databaseSchemaCollapsed}
								{canSave}
								{saveTitle}
								isRunning={executionState.isRunning}
								{canRun}
								runTitle={isMockCluster
									? 'Query execution is unavailable for the mock cluster'
									: 'Run query (Shift+Enter)'}
								{titleFor}
								{isDirty}
								onselect={onselecttab}
								oncompare={oncomparetab}
								onclose={onclosetab}
								oncreate={oncreatetab}
								ontogglecomparison={originalTab ? onstopcomparison : onstartcomparison}
								ontoggleschema={toggleDatabaseSchema}
								{onsave}
								onrun={() => (originalTab && modifiedTab ? onruncomparison() : onrun())}
								{oncancel}
							/>

							<QueryEditorSurface
								bind:this={editorSurface}
								activeTabId={activeTab?.id ?? ''}
								queryText={executionState.queryText}
								{selectedDatabase}
								{databaseSchema}
								clusterUrl={activeClusterUrl}
								{comparisonOriginalTabId}
								{originalTab}
								{modifiedTab}
								{compareCandidates}
								{titleFor}
								onexecute={onrun}
								onexecutecomparison={(side) => onruncomparison(side)}
								{onquerychange}
								{onmodifiedchange}
								{onoriginalchange}
								{oncomparisonoriginalchange}
								{oncomparisonsidechange}
								{onlanguagestatuschange}
							/>

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
													<span class="font-medium">Tip:</span> Check for the Microsoft Entra sign-in
													pop-up to continue.
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
						onCollapse={() => onresultscollapsedchange(true)}
						onExpand={() => onresultscollapsedchange(false)}
					>
						<QueryResults
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
			<DatabaseSchema
				class={isClusterSwitching
					? 'pointer-events-none h-full min-h-0 rounded-none border-0 opacity-60 shadow-none'
					: 'h-full min-h-0 rounded-none border-0 shadow-none'}
				database={databaseSchema[selectedDatabase]}
				expansionState={explorerExpansion}
				{onexpansionchange}
				bind:selectedTable
				bind:selectedFunction
				height="100%"
			/>
		</Resizable.Pane>
	{:else}
		<Resizable.Pane defaultSize={82} minSize={35}>
			<QueryConnectionPlaceholder
				status={connectionStatus}
				error={connectionError}
				clusterName={selectedClusterName}
				showSignInTip={isSelectedLogAnalyticsCluster && showLogAnalyticsSignInTip}
				onretry={onrefresh}
			/>
		</Resizable.Pane>
	{/if}
</Resizable.PaneGroup>

<ConnectionStatus
	status={connectionStatus}
	{...connectionStatistics}
	database={selectedDatabase}
	{languageServiceStatus}
	{isQueryable}
	{emulatedStorage}
	emulatedResultsWarning={isEmulatedCluster}
	onretry={failedClusterId ? onretry : undefined}
/>
