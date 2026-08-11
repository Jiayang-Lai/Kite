<script lang="ts">
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ServerIcon from '@lucide/svelte/icons/server';
	import XIcon from '@lucide/svelte/icons/x';
	import { mode } from 'mode-watcher';
	import { onDestroy } from 'svelte';

	import MonacoEditor from '$lib/components/query/monaco-editor.svelte';
	import QueryResults from '$lib/components/query/query-results.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import * as Resizable from '$lib/components/ui/resizable';
	import * as Select from '$lib/components/ui/select';
	import {
		getKustoErrorMessage,
		isManagementCommand,
		isReadOnlyManagementCommand,
		startKustoManagementCommand
	} from '$lib/kusto/query-client';
	import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
	import type { QueryExecution, QueryResult } from '$lib/types/query-result';
	import type { PaneAPI } from 'paneforge';

	type ManagementCommandWorkspaceProps = {
		databases?: KustoDatabaseSchema;
		selectedDatabase: string;
		clusterUrl: string;
		clusterName: string;
		isMockCluster?: boolean;
		isEmulatedCluster?: boolean;
		isLogAnalyticsCluster?: boolean;
		onrefreshschema?: () => Promise<void> | void;
	};

	let {
		databases,
		selectedDatabase = $bindable(),
		clusterUrl,
		clusterName,
		isMockCluster = false,
		isEmulatedCluster = false,
		isLogAnalyticsCluster = false,
		onrefreshschema
	}: ManagementCommandWorkspaceProps = $props();

	const templates = [
		{ label: 'Show tables', command: '.show tables' },
		{ label: 'Show database schema', command: '.show database schema' },
		{ label: 'Show functions', command: '.show functions' },
		{ label: 'Show ingestion failures', command: '.show ingestion failures' },
		{ label: 'Show operations', command: '.show operations' },
		{ label: 'Show queries', command: '.show queries' },
		{
			label: 'Create database',
			command:
				'.create database yourDbName persist (\n  @"/kustodata/dbs/yourDbName/md",\n  @"/kustodata/dbs/yourDbName/data"\n)'
		},
		{
			label: 'Attach database',
			command: '.attach database yourDbName from @"/kustodata/dbs/yourDbName/md"'
		}
	];

	let commandText = $state('.show tables');
	let templateValue = $state(templates[0].command);
	let result = $state<QueryResult>();
	let commandError = $state('');
	let isRunning = $state(false);
	let resultsCollapsed = $state(false);
	let resultsPane = $state<PaneAPI>();
	let autoRefreshAfterChange = $state(true);
	let activeExecution: QueryExecution | undefined;
	let requestId = 0;
	let showConfirmation = $state(false);
	let confirmationText = $state('');

	const databaseNames = $derived(Object.values(databases ?? {}).map((database) => database.name));
	const canRun = $derived(
		Boolean(
			commandText.trim() &&
			selectedDatabase &&
			!isMockCluster &&
			!isEmulatedCluster &&
			!isLogAnalyticsCluster &&
			!isRunning
		)
	);
	const changesClusterState = $derived(
		isManagementCommand(commandText) && !isReadOnlyManagementCommand(commandText)
	);
	const editorTheme = $derived(mode.current === 'dark' ? 'vs-dark' : 'vs');

	$effect(() => {
		if (!databaseNames.length) return;
		if (!databaseNames.includes(selectedDatabase)) selectedDatabase = databaseNames[0];
	});

	function selectTemplate(nextValue: string) {
		templateValue = nextValue;
		commandText = nextValue;
	}

	function requestRun() {
		const command = commandText.trim();
		if (
			!command ||
			!selectedDatabase ||
			isMockCluster ||
			isEmulatedCluster ||
			isLogAnalyticsCluster ||
			isRunning
		)
			return;
		if (!isManagementCommand(command)) {
			commandError = 'Management commands must start with a period, for example .show tables.';
			return;
		}

		if (changesClusterState) {
			confirmationText = '';
			showConfirmation = true;
			return;
		}
		void runCommand(command);
	}

	function confirmRun() {
		if (confirmationText !== 'RUN') return;
		showConfirmation = false;
		void runCommand(commandText.trim());
	}

	async function runCommand(command: string) {
		const nextRequestId = ++requestId;
		const shouldRefreshSchema =
			autoRefreshAfterChange && !isReadOnlyManagementCommand(command) && Boolean(onrefreshschema);
		commandError = '';
		result = undefined;
		resultsCollapsed = false;
		isRunning = true;
		try {
			activeExecution = startKustoManagementCommand(selectedDatabase, command, clusterUrl);
			const completedResult = await activeExecution.promise;
			if (nextRequestId === requestId) {
				result = completedResult;
				if (shouldRefreshSchema) await onrefreshschema?.();
			}
		} catch (error) {
			if (nextRequestId === requestId) commandError = getKustoErrorMessage(error);
		} finally {
			if (nextRequestId === requestId) {
				activeExecution = undefined;
				isRunning = false;
			}
		}
	}

	function cancelCommand() {
		activeExecution?.cancel();
	}

	function setResultsCollapsed(collapsed: boolean) {
		resultsCollapsed = collapsed;
		if (collapsed) {
			resultsPane?.collapse();
		} else {
			resultsPane?.expand();
		}
	}

	function toggleAutoRefresh() {
		autoRefreshAfterChange = !autoRefreshAfterChange;
	}

	onDestroy(() => {
		requestId += 1;
		activeExecution?.cancel();
	});
</script>

<section class="relative flex min-h-0 flex-1 flex-col gap-2">
	{#if isMockCluster || isEmulatedCluster || isLogAnalyticsCluster}
		<Card.Root class="min-h-0 flex-1">
			<Card.Content class="grid h-full place-items-center p-6 text-center">
				<div class="max-w-md">
					<ServerIcon class="text-muted-foreground mx-auto mb-3 size-7" />
					<h2 class="font-semibold">
						{isLogAnalyticsCluster
							? 'Management commands are not supported for Log Analytics workspaces'
							: isEmulatedCluster
								? 'Management commands are not supported for emulated clusters'
								: 'Management commands need a connected cluster'}
					</h2>
					<p class="text-muted-foreground mt-2 text-sm leading-6">
						{isLogAnalyticsCluster
							? 'Log Analytics exposes a query API rather than the Kusto management endpoint. Use the Query Explorer to run KQL.'
							: isEmulatedCluster
								? 'Use the Databases & tables page for supported DuckDB-backed schema operations, or select a remote Kusto connection to run administrative commands.'
								: 'The Mock cluster supplies local schema data only. Select a remote Kusto connection to run administrative commands.'}
					</p>
					<code class="bg-muted mt-4 inline-block rounded-md px-3 py-2 text-sm">.show tables</code>
				</div>
			</Card.Content>
		</Card.Root>
	{:else if !databaseNames.length}
		<Card.Root class="min-h-0 flex-1">
			<Card.Content
				class="text-muted-foreground grid h-full place-items-center p-6 text-center text-sm"
			>
				Connect to a cluster with at least one database before running management commands.
			</Card.Content>
		</Card.Root>
	{:else}
		<Resizable.PaneGroup
			direction="vertical"
			autoSaveId="kite-admin-command-layout"
			class="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background"
		>
			<Resizable.Pane defaultSize={66} minSize={30}>
				<div
					class="flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-background py-2 text-sm sm:gap-3 sm:py-3"
				>
					<div class="grid auto-rows-min items-start gap-3 border-b px-2 pb-2 sm:px-3 sm:pb-3">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div class="flex min-w-0 items-center gap-2">
								<ServerIcon class="text-muted-foreground size-4 shrink-0" />
								<label class="text-muted-foreground text-xs" for="command-database">Database</label>
								<Select.Root type="single" bind:value={selectedDatabase}>
									<Select.Trigger id="command-database" size="sm" class="max-w-52">
										<Select.Value placeholder="Select database" />
									</Select.Trigger>
									<Select.Content>
										<Select.Group>
											{#each databaseNames as databaseName (databaseName)}
												<Select.Item value={databaseName} label={databaseName} />
											{/each}
										</Select.Group>
									</Select.Content>
								</Select.Root>
							</div>
							<div class="flex items-center gap-2">
								<label class="sr-only" for="command-template">Command template</label>
								<Select.Root
									type="single"
									bind:value={templateValue}
									onValueChange={selectTemplate}
								>
									<Select.Trigger id="command-template" size="sm" class="max-w-56">
										<Select.Value placeholder="Choose a template" />
									</Select.Trigger>
									<Select.Content>
										<Select.Group>
											{#each templates as template (template.command)}
												<Select.Item value={template.command} label={template.label} />
											{/each}
										</Select.Group>
									</Select.Content>
								</Select.Root>
								<Button
									variant={autoRefreshAfterChange ? 'default' : 'outline'}
									size="sm"
									onclick={toggleAutoRefresh}
									aria-pressed={autoRefreshAfterChange}
									title="Refresh the schema after a state-changing command"
								>
									<RefreshCwIcon /> Auto-refresh {autoRefreshAfterChange ? 'on' : 'off'}
								</Button>
							</div>
						</div>
						<p class="text-muted-foreground text-xs">
							Commands run against <span class="text-foreground font-medium">{clusterName}</span>.
							Kusto enforces your permissions.
						</p>
					</div>
					<div class="flex min-h-0 flex-1 flex-col gap-2 px-2 sm:px-3">
						<MonacoEditor
							bind:value={commandText}
							class="min-h-0 flex-1"
							database={selectedDatabase}
							databaseSchema={databases ?? {}}
							height="100%"
							{clusterUrl}
							theme={editorTheme}
							onexecute={requestRun}
						/>
						<div class="flex flex-wrap items-center justify-between gap-2">
							<p class="text-muted-foreground text-xs">Management commands must start with “.”</p>
							<div class="flex items-center gap-2">
								{#if changesClusterState}
									<Badge variant="outline" class="border-warning/40 bg-warning/10 text-warning">
										<CircleAlertIcon /> Changes cluster state
									</Badge>
								{/if}
								{#if isRunning}
									<Button variant="outline" size="sm" onclick={cancelCommand}>
										<CircleStopIcon /> Cancel
									</Button>
								{:else}
									<Button
										size="sm"
										class={changesClusterState
											? 'bg-warning text-warning-foreground hover:bg-warning/80 focus-visible:ring-warning'
											: undefined}
										disabled={!canRun}
										onclick={requestRun}
										title="Run command (Ctrl/Cmd+Enter)"
										aria-keyshortcuts="Control+Enter Meta+Enter"
									>
										<PlayIcon /> Run
									</Button>
								{/if}
							</div>
						</div>
					</div>
				</div>
			</Resizable.Pane>

			<Resizable.Handle />

			<Resizable.Pane
				bind:this={resultsPane}
				defaultSize={34}
				minSize={5}
				collapsible
				collapsedSize={5}
				onCollapse={() => (resultsCollapsed = true)}
				onExpand={() => (resultsCollapsed = false)}
			>
				<QueryResults
					class="h-full min-h-0 rounded-none border-0 bg-background"
					{result}
					error={commandError}
					{isRunning}
					collapsed={resultsCollapsed}
					oncollapsedchange={setResultsCollapsed}
					operationLabel="Command"
				/>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	{/if}

	{#if showConfirmation}
		<div
			class="absolute inset-0 z-30 grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
			role="presentation"
		>
			<Card.Root
				class="w-full max-w-xl shadow-lg"
				role="dialog"
				aria-modal="true"
				aria-labelledby="confirm-command-title"
			>
				<Card.Header>
					<div class="flex items-start justify-between gap-3">
						<div>
							<Card.Title id="confirm-command-title">Run management command?</Card.Title>
							<Card.Description>This command may modify cluster state.</Card.Description>
						</div>
						<Button
							variant="ghost"
							size="icon-xs"
							onclick={() => (showConfirmation = false)}
							aria-label="Close confirmation"
						>
							<XIcon />
						</Button>
					</div>
				</Card.Header>
				<Card.Content class="space-y-4">
					<dl class="text-sm">
						<div class="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
							<dt class="text-muted-foreground">Cluster</dt>
							<dd>{clusterName}</dd>
						</div>
						<div class="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
							<dt class="text-muted-foreground">Database</dt>
							<dd>{selectedDatabase}</dd>
						</div>
					</dl>
					<pre
						class="bg-muted max-h-40 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">{commandText.trim()}</pre>
					<div>
						<label class="text-sm font-medium" for="confirm-run">Type RUN to enable execution</label
						>
						<Input id="confirm-run" class="mt-2" bind:value={confirmationText} autocomplete="off" />
					</div>
				</Card.Content>
				<Card.Footer class="justify-end gap-2">
					<Button variant="outline" onclick={() => (showConfirmation = false)}>Cancel</Button>
					<Button variant="destructive" disabled={confirmationText !== 'RUN'} onclick={confirmRun}>
						<PlayIcon /> Run command
					</Button>
				</Card.Footer>
			</Card.Root>
		</div>
	{/if}
</section>
