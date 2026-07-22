<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FileUpIcon from '@lucide/svelte/icons/file-up';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import PlayIcon from '@lucide/svelte/icons/play';
	import ServerIcon from '@lucide/svelte/icons/server';
	import TablePropertiesIcon from '@lucide/svelte/icons/table-properties';
	import XIcon from '@lucide/svelte/icons/x';
	import { onDestroy } from 'svelte';

	import QueryResults from '$lib/components/query/query-results.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import * as Resizable from '$lib/components/ui/resizable';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Select from '$lib/components/ui/select';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		buildInlineIngestionCommand,
		buildMountedFileIngestionCommand,
		getInlineFilePayloadBudget,
		resolveMountedFilePath,
		type MountedFileFormat
	} from '$lib/kusto/ingestion';
	import {
		formatBytes,
		hashInlineCsvChunk,
		planInlineCsvFile,
		readInlineCsvChunk,
		type InlineCsvPlan
	} from '$lib/kusto/inline-file';
	import {
		getKustoErrorMessage,
		startKustoManagementCommand,
		type KustoIngestionConfiguration
	} from '$lib/kusto/query-client';
	import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
	import type { QueryExecution, QueryResult } from '$lib/types/query-result';
	import type { PaneAPI } from 'paneforge';

	type SourceMode = 'inline' | 'inline-file' | 'file';
	type InlineFileState =
		'idle' | 'scanning' | 'ready' | 'running' | 'partial' | 'cancelled' | 'succeeded' | 'failed';

	type DataIngestionWorkspaceProps = {
		databases?: KustoDatabaseSchema;
		selectedDatabase: string;
		selectedTable?: string;
		clusterUrl: string;
		clusterName: string;
		ingestion?: KustoIngestionConfiguration;
		isMockCluster?: boolean;
		isLoading?: boolean;
	};

	let {
		databases,
		selectedDatabase = $bindable(),
		selectedTable = $bindable(),
		clusterUrl,
		clusterName,
		ingestion,
		isMockCluster = false,
		isLoading = false
	}: DataIngestionWorkspaceProps = $props();

	const INLINE_DATA_MAX_LENGTH = 100_000;
	let sourceMode = $state<SourceMode>('inline');
	let inlineData = $state('');
	let selectedFiles = $state.raw<FileList>();
	let inlineFile = $state.raw<File>();
	let inlineFileVersion = $state(0);
	let inlineFileHasHeader = $state(true);
	let inlineFilePlan = $state.raw<InlineCsvPlan>();
	let inlineFileState = $state<InlineFileState>('idle');
	let inlineFileError = $state('');
	let inlineFileScanProgress = $state(0);
	let completedFileChunks = $state(0);
	let completedFileRecords = $state(0);
	let activeFileChunk = $state<number>();
	let extentIds = $state<string[]>([]);
	let plannedInlineFileKey = '';
	let scanRequestId = 0;
	let scanController: AbortController | undefined;
	let relativePath = $state('');
	let fileFormat = $state<MountedFileFormat>('parquet');
	let result = $state<QueryResult>();
	let ingestionError = $state('');
	let isRunning = $state(false);
	let resultsCollapsed = $state(false);
	let resultsPane = $state<PaneAPI>();
	let showConfirmation = $state(false);
	let confirmationText = $state('');
	let pendingCommand = $state('');
	let activeExecution: QueryExecution | undefined;
	let cancelRequested = false;
	let requestId = 0;

	const databaseEntries = $derived(Object.values(databases ?? {}));
	const databaseNames = $derived(databaseEntries.map((database) => database.name));
	const activeDatabase = $derived(selectedDatabase ? databases?.[selectedDatabase] : undefined);
	const tableEntries = $derived(activeDatabase?.tables ?? []);
	const activeTable = $derived(
		selectedTable ? tableEntries.find((table) => table.name === selectedTable) : undefined
	);
	const resolvedFilePath = $derived.by(() => {
		if (!ingestion || !relativePath.trim()) return '';
		try {
			return resolveMountedFilePath(ingestion.containerRoot, relativePath);
		} catch {
			return '';
		}
	});
	const preparedCommand = $derived.by(() => {
		try {
			if (!ingestion) throw new Error('Data ingestion is not configured for this connection.');
			const table = selectedTable ?? '';
			if (sourceMode === 'inline-file') return { command: '', error: '' };
			const command =
				sourceMode === 'inline'
					? buildInlineIngestionCommand({ table, data: inlineData })
					: buildMountedFileIngestionCommand({
							table,
							containerRoot: ingestion.containerRoot,
							relativePath,
							format: fileFormat
						});
			return { command, error: '' };
		} catch (error) {
			return { command: '', error: error instanceof Error ? error.message : String(error) };
		}
	});
	const canIngest = $derived(
		Boolean(
			ingestion &&
			selectedDatabase &&
			selectedTable &&
			!isRunning &&
			(sourceMode === 'inline-file'
				? inlineFilePlan && ['ready', 'partial', 'cancelled', 'failed'].includes(inlineFileState)
				: preparedCommand.command)
		)
	);
	const hasSourceInput = $derived(
		sourceMode === 'inline'
			? Boolean(inlineData)
			: sourceMode === 'inline-file'
				? Boolean(inlineFile)
				: Boolean(relativePath)
	);
	const fileExecutionProgress = $derived(
		inlineFilePlan?.chunks.length
			? Math.round((completedFileChunks / inlineFilePlan.chunks.length) * 100)
			: 0
	);
	const inlineFileSourceSummary = $derived(
		inlineFile && inlineFilePlan
			? `${inlineFile.name} · ${inlineFilePlan.totalRecords.toLocaleString()} rows · ${inlineFilePlan.chunks.length} chunks`
			: (inlineFile?.name ?? 'Inline CSV file')
	);
	const confirmationSource = $derived(
		sourceMode === 'inline'
			? 'Inline CSV'
			: sourceMode === 'inline-file'
				? inlineFileSourceSummary
				: resolvedFilePath
	);
	const inlineFileStatusLabel = $derived(
		(
			{
				ready: 'Ready',
				running: 'Running',
				partial: 'Partial',
				cancelled: 'Cancelled',
				succeeded: 'Complete',
				failed: 'Failed'
			} as Partial<Record<InlineFileState, string>>
		)[inlineFileState] ?? 'Ready'
	);

	$effect(() => {
		if (!databaseNames.length) return;
		if (!databaseNames.includes(selectedDatabase)) selectedDatabase = databaseNames[0];
	});

	$effect(() => {
		const file = inlineFile;
		const table = selectedTable;
		const planKey = `${inlineFileVersion}\0${table ?? ''}\0${inlineFileHasHeader}`;
		if (!file || !table || !ingestion || planKey === plannedInlineFileKey || isRunning) return;
		plannedInlineFileKey = planKey;
		void scanInlineFile(file, table);
	});

	function selectInlineFile() {
		inlineFile = selectedFiles?.[0];
		inlineFileVersion += 1;
		plannedInlineFileKey = '';
		inlineFilePlan = undefined;
		inlineFileState = inlineFile ? 'scanning' : 'idle';
		inlineFileError = '';
		completedFileChunks = 0;
		completedFileRecords = 0;
		extentIds = [];
	}

	function rescanInlineFile() {
		if (!inlineFile) return;
		plannedInlineFileKey = '';
		inlineFileVersion += 1;
	}

	async function scanInlineFile(file: File, table: string) {
		const nextScanRequestId = ++scanRequestId;
		scanController?.abort();
		scanController = new AbortController();
		inlineFilePlan = undefined;
		inlineFileState = 'scanning';
		inlineFileError = '';
		inlineFileScanProgress = 0;
		completedFileChunks = 0;
		completedFileRecords = 0;
		extentIds = [];
		try {
			if (!file.name.toLowerCase().endsWith('.csv')) {
				throw new Error('Inline file ingestion currently accepts uncompressed .csv files only.');
			}
			const maxPayloadBytes = getInlineFilePayloadBudget(
				table,
				ingestion?.maxInlineCommandBytes ?? 0
			);
			const plan = await planInlineCsvFile(file, {
				maxFileBytes: ingestion?.maxInlineFileBytes ?? 0,
				maxPayloadBytes,
				hasHeader: inlineFileHasHeader,
				signal: scanController.signal,
				onProgress(scannedBytes, totalBytes) {
					if (nextScanRequestId === scanRequestId) {
						inlineFileScanProgress = Math.round((scannedBytes / totalBytes) * 100);
					}
				}
			});
			if (nextScanRequestId !== scanRequestId) return;
			inlineFilePlan = plan;
			inlineFileState = 'ready';
			inlineFileScanProgress = 100;
		} catch (error) {
			if (nextScanRequestId !== scanRequestId) return;
			if (error instanceof DOMException && error.name === 'AbortError') {
				inlineFileState = 'cancelled';
				inlineFileError = 'CSV scan cancelled.';
			} else {
				inlineFileState = 'failed';
				inlineFileError = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (nextScanRequestId === scanRequestId) scanController = undefined;
		}
	}

	$effect(() => {
		const firstTable = tableEntries[0];
		if (firstTable && !tableEntries.some((table) => table.name === selectedTable)) {
			selectedTable = firstTable.name;
		} else if (!firstTable) {
			selectedTable = undefined;
		}
	});

	function requestIngestion() {
		if (!canIngest) {
			ingestionError = preparedCommand.error;
			return;
		}
		pendingCommand =
			sourceMode === 'inline-file'
				? `${inlineFilePlan?.chunks.length ?? 0} sequential .ingest inline commands with per-chunk ingest-by tags`
				: preparedCommand.command;
		confirmationText = '';
		showConfirmation = true;
	}

	function confirmIngestion() {
		if (confirmationText !== 'RUN' || !pendingCommand) return;
		showConfirmation = false;
		if (sourceMode === 'inline-file') void runInlineFileIngestion();
		else void runIngestion(pendingCommand);
	}

	async function runIngestion(command: string) {
		const nextRequestId = ++requestId;
		ingestionError = '';
		result = undefined;
		isRunning = true;
		try {
			activeExecution = startKustoManagementCommand(selectedDatabase, command, clusterUrl);
			const completedResult = await activeExecution.promise;
			if (nextRequestId === requestId) result = completedResult;
		} catch (error) {
			if (nextRequestId === requestId) {
				const message = getKustoErrorMessage(error);
				ingestionError =
					message === 'Command cancelled.'
						? 'Stopped waiting for ingestion. The Kusto operation may still complete.'
						: message;
			}
		} finally {
			if (nextRequestId === requestId) {
				activeExecution = undefined;
				isRunning = false;
			}
		}
	}

	async function runInlineFileIngestion() {
		const file = inlineFile;
		const plan = inlineFilePlan;
		const table = selectedTable;
		const database = selectedDatabase;
		if (!file || !plan || !table || !ingestion) return;

		const nextRequestId = ++requestId;
		cancelRequested = false;
		ingestionError = '';
		result = undefined;
		isRunning = true;
		inlineFileState = 'running';
		try {
			for (let index = completedFileChunks; index < plan.chunks.length; index += 1) {
				if (cancelRequested || nextRequestId !== requestId) break;
				const chunk = plan.chunks[index];
				activeFileChunk = index;
				const data = await readInlineCsvChunk(file, chunk);
				const hash = await hashInlineCsvChunk(database, table, data);
				const command = buildInlineIngestionCommand({
					table,
					data,
					ingestBy: `kite-inline-file:${hash}`
				});
				if (new TextEncoder().encode(command).byteLength > ingestion.maxInlineCommandBytes) {
					throw new Error(`Chunk ${index + 1} exceeds the configured inline command limit.`);
				}
				if (cancelRequested || nextRequestId !== requestId) break;

				activeExecution = startKustoManagementCommand(database, command, clusterUrl);
				const completedResult = await activeExecution.promise;
				if (nextRequestId !== requestId) return;
				result = completedResult;
				completedFileChunks = index + 1;
				completedFileRecords += chunk.recordCount;
				const extentColumn = completedResult.columns.findIndex(
					(column) => column.name.toLowerCase() === 'extentid'
				);
				if (extentColumn >= 0) {
					extentIds = [
						...extentIds,
						...completedResult.rows
							.map((row) => row[extentColumn])
							.filter((value): value is string => typeof value === 'string' && Boolean(value))
					];
				}
				activeExecution = undefined;
			}

			if (nextRequestId !== requestId) return;
			inlineFileState = cancelRequested
				? 'cancelled'
				: completedFileChunks === plan.chunks.length
					? 'succeeded'
					: 'partial';
			if (cancelRequested) {
				ingestionError =
					'Stopped inline-file ingestion. Completed chunks remain ingested; the active chunk may also complete.';
			}
		} catch (error) {
			if (nextRequestId !== requestId) return;
			const message = getKustoErrorMessage(error);
			ingestionError =
				message === 'Command cancelled.'
					? 'Stopped inline-file ingestion. Completed chunks remain ingested; the active chunk may also complete.'
					: message;
			inlineFileError = ingestionError;
			inlineFileState = completedFileChunks ? 'partial' : cancelRequested ? 'cancelled' : 'failed';
		} finally {
			if (nextRequestId === requestId) {
				activeExecution = undefined;
				activeFileChunk = undefined;
				isRunning = false;
			}
		}
	}

	function cancelIngestion() {
		cancelRequested = true;
		scanController?.abort();
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

	onDestroy(() => {
		requestId += 1;
		scanRequestId += 1;
		scanController?.abort();
		activeExecution?.cancel();
	});
</script>

<section class="relative flex min-h-0 flex-1 flex-col">
	{#if isMockCluster || !ingestion}
		<Card.Root class="min-h-0 flex-1 bg-background shadow-xs">
			<Card.Content class="grid h-full place-items-center p-6 text-center">
				<div class="max-w-lg">
					<ServerIcon class="text-muted-foreground mx-auto mb-3 size-7" />
					<h2 class="font-semibold">Data ingestion needs a configured Kustainer connection</h2>
					<p class="text-muted-foreground mt-2 text-sm leading-6">
						{isMockCluster
							? 'The Mock cluster supplies schema data only. Select Local Kusto to ingest data.'
							: 'This connection does not declare a mounted ingestion directory.'}
					</p>
				</div>
			</Card.Content>
		</Card.Root>
	{:else if !databaseNames.length}
		<Card.Root class="min-h-0 flex-1 bg-background shadow-xs">
			<Card.Content
				class="text-muted-foreground grid h-full place-items-center p-6 text-center text-sm"
			>
				{isLoading
					? 'Loading databases and tables…'
					: 'Connect to a cluster with an existing database and table before ingesting data.'}
			</Card.Content>
		</Card.Root>
	{:else}
		<Resizable.PaneGroup
			direction="vertical"
			autoSaveId="kite-admin-ingestion-layout"
			class="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background shadow-xs"
		>
			<Resizable.Pane defaultSize={66} minSize={30}>
				<div class="flex h-full min-h-0 flex-col bg-background">
					<div class="border-b px-2 py-2 sm:px-3 sm:py-3">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div>
								<h2 class="font-semibold">Ingest into an existing table</h2>
								<p class="text-muted-foreground mt-1 text-sm">
									Direct ingestion appends data to the selected Kustainer table.
									{#if selectedDatabase === 'NetDefaultDB'}
										<span class="mt-1 block text-amber-700 dark:text-amber-300">
											Data in NetDefaultDB is stored inside the Kustainer container and will be lost if the container is destroyed. It is highly recommended to create a new database at a mounted volume for persistent data.
										</span>
									{/if}
								</p>
							</div>
							<Badge variant="outline">Local emulator</Badge>
						</div>
					</div>
					<div
						class="grid min-h-0 flex-1 gap-4 overflow-auto p-2 sm:p-3 lg:grid-cols-[minmax(0,1fr)_18rem]"
					>
						<div class="min-w-0 space-y-4">
							<div class="grid gap-3 sm:grid-cols-2">
								<div>
									<label class="text-sm font-medium" for="ingestion-database">Database</label>
									<Select.Root type="single" bind:value={selectedDatabase} disabled={isRunning}>
										<Select.Trigger id="ingestion-database" class="mt-1 w-full">
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
								<div>
									<label class="text-sm font-medium" for="ingestion-table">Table</label>
									<Select.Root
										type="single"
										bind:value={selectedTable}
										disabled={isRunning || !tableEntries.length}
									>
										<Select.Trigger id="ingestion-table" class="mt-1 w-full">
											<Select.Value placeholder="Select table" />
										</Select.Trigger>
										<Select.Content>
											<Select.Group>
												{#each tableEntries as table (table.name)}
													<Select.Item value={table.name} label={table.name} />
												{/each}
											</Select.Group>
										</Select.Content>
									</Select.Root>
								</div>
							</div>

							<Tabs.Root bind:value={sourceMode}>
								<Tabs.List>
									<Tabs.Trigger value="inline" disabled={isRunning}
										><FileTextIcon /> Inline CSV</Tabs.Trigger
									>
									<Tabs.Trigger value="inline-file" disabled={isRunning}
										><FileUpIcon /> Inline file</Tabs.Trigger
									>
									<Tabs.Trigger value="file" disabled={isRunning}
										><FolderOpenIcon /> Mounted file</Tabs.Trigger
									>
								</Tabs.List>

								<Tabs.Content value="inline" class="space-y-2">
									<div class="flex items-center justify-between gap-3">
										<label class="text-sm font-medium" for="inline-ingestion-data">CSV rows</label>
										<span class="text-muted-foreground text-xs tabular-nums">
											{inlineData.length.toLocaleString()} / {INLINE_DATA_MAX_LENGTH.toLocaleString()}
										</span>
									</div>
									<Textarea
										id="inline-ingestion-data"
										bind:value={inlineData}
										maxlength={INLINE_DATA_MAX_LENGTH}
										disabled={isRunning}
										class="min-h-40 resize-y font-mono text-xs"
										placeholder={'2026-07-22T12:00:00Z,sensor-1,temperature,21.5\n2026-07-22T12:01:00Z,sensor-2,humidity,45.2'}
									/>
									<p class="text-muted-foreground text-xs">
										Values are parsed as CSV in the table column order. Whitespace and line breaks
										are preserved.
									</p>
								</Tabs.Content>

								<Tabs.Content value="inline-file" class="space-y-3">
									<div>
										<label class="text-sm font-medium" for="inline-file-input">CSV file</label>
										<Input
											id="inline-file-input"
											type="file"
											accept=".csv,text/csv"
											bind:files={selectedFiles}
											onchange={selectInlineFile}
											disabled={isRunning}
											class="mt-1"
										/>
									</div>

									<label class="flex w-fit items-center gap-2 text-sm">
										<input
											type="checkbox"
											bind:checked={inlineFileHasHeader}
											disabled={isRunning}
											class="border-input accent-primary size-4 rounded border"
										/>
										First row contains column names
									</label>

									{#if inlineFileState === 'scanning'}
										<div class="space-y-2 rounded-md border p-3" aria-live="polite">
											<div class="flex items-center justify-between gap-3 text-xs">
												<span>Scanning {inlineFile?.name}</span>
												<span class="text-muted-foreground tabular-nums"
													>{inlineFileScanProgress}%</span
												>
											</div>
											<div class="bg-muted h-1.5 overflow-hidden rounded-full">
												<div
													class="bg-primary h-full transition-[width]"
													style:width={`${inlineFileScanProgress}%`}
												></div>
											</div>
										</div>
									{:else if inlineFilePlan && inlineFile}
										<div class="space-y-3 rounded-md border p-3">
											<div class="flex flex-wrap items-center justify-between gap-2">
												<div class="min-w-0">
													<p class="truncate text-sm font-medium">{inlineFile.name}</p>
													<p class="text-muted-foreground text-xs">
														{formatBytes(inlineFile.size)} · UTF-8 CSV
													</p>
												</div>
												<Badge
													variant={inlineFileState === 'succeeded'
														? 'secondary'
														: inlineFileState === 'failed'
															? 'destructive'
															: 'outline'}
												>
													{inlineFileStatusLabel}
												</Badge>
											</div>
											<dl class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
												<div class="bg-muted rounded-md p-2">
													<dt class="text-muted-foreground">Rows</dt>
													<dd class="mt-1 font-medium tabular-nums">
														{inlineFilePlan.totalRecords.toLocaleString()}
													</dd>
												</div>
												<div class="bg-muted rounded-md p-2">
													<dt class="text-muted-foreground">Columns</dt>
													<dd class="mt-1 font-medium tabular-nums">
														{inlineFilePlan.columnCount}
													</dd>
												</div>
												<div class="bg-muted rounded-md p-2">
													<dt class="text-muted-foreground">Chunks</dt>
													<dd class="mt-1 font-medium tabular-nums">
														{inlineFilePlan.chunks.length}
													</dd>
												</div>
												<div class="bg-muted rounded-md p-2">
													<dt class="text-muted-foreground">Data</dt>
													<dd class="mt-1 font-medium tabular-nums">
														{formatBytes(inlineFilePlan.dataBytes)}
													</dd>
												</div>
											</dl>
											{#if inlineFilePlan.header}
												<p
													class="text-muted-foreground truncate text-xs"
													title={inlineFilePlan.header}
												>
													Header: <code>{inlineFilePlan.header}</code>
												</p>
											{/if}
											{#if activeTable && inlineFilePlan.columnCount !== activeTable.columns.length}
												<p
													class="flex gap-2 text-xs text-amber-700 dark:text-amber-300"
													role="alert"
												>
													<CircleAlertIcon class="size-4 shrink-0" /> File rows have {inlineFilePlan.columnCount}
													columns; {activeTable.name} has {activeTable.columns.length}.
												</p>
											{/if}
											{#if inlineFilePlan.inconsistentRecordCount}
												<p
													class="flex gap-2 text-xs text-amber-700 dark:text-amber-300"
													role="alert"
												>
													<CircleAlertIcon class="size-4 shrink-0" />
													{inlineFilePlan.inconsistentRecordCount.toLocaleString()} rows have a different
													column count.
												</p>
											{/if}

											{#if inlineFileState === 'running' || completedFileChunks > 0}
												<div class="space-y-2 border-t pt-3" aria-live="polite">
													<div class="flex items-center justify-between gap-3 text-xs">
														<span>
															{inlineFileState === 'running' && activeFileChunk !== undefined
																? `Ingesting chunk ${activeFileChunk + 1} of ${inlineFilePlan.chunks.length}`
																: `${completedFileChunks} of ${inlineFilePlan.chunks.length} chunks completed`}
														</span>
														<span class="text-muted-foreground tabular-nums"
															>{fileExecutionProgress}%</span
														>
													</div>
													<div class="bg-muted h-1.5 overflow-hidden rounded-full">
														<div
															class="bg-primary h-full transition-[width]"
															style:width={`${fileExecutionProgress}%`}
														></div>
													</div>
													<p class="text-muted-foreground text-xs">
														{completedFileRecords.toLocaleString()} rows confirmed
														{#if extentIds.length}
															· {extentIds.length} extents returned{/if}
													</p>
												</div>
											{/if}
										</div>
									{:else if inlineFileError}
										<div class="space-y-2">
											<p
												class="text-destructive flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs"
												role="alert"
											>
												<CircleAlertIcon class="size-4 shrink-0" />
												{inlineFileError}
											</p>
											{#if inlineFile}
												<Button variant="outline" size="sm" onclick={rescanInlineFile}
													>Scan again</Button
												>
											{/if}
										</div>
									{:else}
										<p class="text-muted-foreground text-xs">
											The file stays in the browser and is sent sequentially as record-safe inline
											commands. Limit: {formatBytes(ingestion.maxInlineFileBytes)}.
										</p>
									{/if}
								</Tabs.Content>

								<Tabs.Content value="file" class="space-y-3">
									<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
										<div>
											<label class="text-sm font-medium" for="mounted-file-path"
												>Relative file path</label
											>
											<Input
												id="mounted-file-path"
												bind:value={relativePath}
												disabled={isRunning}
												class="mt-1 font-mono"
												placeholder="import.parquet"
											/>
										</div>
										<div>
											<label class="text-sm font-medium" for="mounted-file-format">Format</label>
											<Select.Root type="single" bind:value={fileFormat} disabled={isRunning}>
												<Select.Trigger id="mounted-file-format" class="mt-1 w-full">
													<Select.Value />
												</Select.Trigger>
												<Select.Content>
													<Select.Item value="parquet" label="Parquet" />
													<Select.Item value="csv" label="CSV" />
												</Select.Content>
											</Select.Root>
										</div>
									</div>
									<div class="bg-muted rounded-md p-3 text-xs">
										<p class="text-muted-foreground">Kustainer source path</p>
										<code class="mt-1 block break-all"
											>{resolvedFilePath || `${ingestion.containerRoot}/…`}</code
										>
									</div>
									<p class="text-muted-foreground text-xs">
										The file must already exist below <code>{ingestion.containerRoot}</code> inside the
										container.
									</p>
								</Tabs.Content>
							</Tabs.Root>

							{#if preparedCommand.error && hasSourceInput}
								<p class="text-destructive flex items-center gap-2 text-xs" role="alert">
									<CircleAlertIcon class="size-4 shrink-0" />
									{preparedCommand.error}
								</p>
							{/if}

							<div class="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
								<p class="text-muted-foreground text-xs">
									Runs against <span class="text-foreground font-medium">{clusterName}</span>. Data
									is appended.
								</p>
								{#if isRunning}
									<Button variant="outline" size="sm" onclick={cancelIngestion}>
										<CircleStopIcon /> Stop waiting
									</Button>
								{:else if sourceMode === 'inline-file' && inlineFileState === 'scanning'}
									<Button variant="outline" size="sm" onclick={cancelIngestion}>
										<CircleStopIcon /> Cancel scan
									</Button>
								{:else}
									<Button size="sm" disabled={!canIngest} onclick={requestIngestion}>
										<PlayIcon />
										{sourceMode === 'inline-file' && completedFileChunks
											? 'Review retry'
											: 'Review ingestion'}
									</Button>
								{/if}
							</div>
						</div>

						<aside class="min-h-0 rounded-lg border">
							<div class="flex items-center gap-2 border-b p-3">
								<TablePropertiesIcon class="text-muted-foreground size-4" />
								<div class="min-w-0">
									<p class="truncate text-sm font-medium">
										{activeTable?.name ?? 'Select a table'}
									</p>
									<p class="text-muted-foreground text-xs">Target column order</p>
								</div>
							</div>
							<ScrollArea class="h-64 lg:h-[calc(100%-3.75rem)]" orientation="vertical" type="auto">
								{#if activeTable?.columns.length}
									<ol class="divide-y">
										{#each activeTable.columns as column, index (`${column.name}:${index}`)}
											<li class="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 px-3 py-2 text-xs">
												<span class="text-muted-foreground text-right tabular-nums"
													>{index + 1}</span
												>
												<span class="min-w-0">
													<span class="block truncate font-medium">{column.name}</span>
													<span class="text-muted-foreground font-mono">{column.type}</span>
												</span>
											</li>
										{/each}
									</ol>
								{:else}
									<p class="text-muted-foreground p-4 text-center text-xs">
										No table columns available.
									</p>
								{/if}
							</ScrollArea>
						</aside>
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
					error={ingestionError}
					{isRunning}
					collapsed={resultsCollapsed}
					oncollapsedchange={setResultsCollapsed}
					operationLabel="Data load"
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
				aria-labelledby="confirm-ingestion-title"
			>
				<Card.Header>
					<div class="flex items-start justify-between gap-3">
						<div>
							<Card.Title id="confirm-ingestion-title">Ingest data into {selectedTable}?</Card.Title
							>
							<Card.Description
								>This operation appends data and cannot be rolled back here.</Card.Description
							>
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
					<dl class="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
						<dt class="text-muted-foreground">Cluster</dt>
						<dd>{clusterName}</dd>
						<dt class="text-muted-foreground">Database</dt>
						<dd>{selectedDatabase}</dd>
						<dt class="text-muted-foreground">Table</dt>
						<dd>{selectedTable}</dd>
						<dt class="text-muted-foreground">Source</dt>
						<dd>{confirmationSource}</dd>
						<dt class="text-muted-foreground">Mode</dt>
						<dd>Append</dd>
					</dl>
					<pre
						class="bg-muted max-h-36 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">{pendingCommand}</pre>
					<div>
						<label class="text-sm font-medium" for="confirm-ingestion"
							>Type RUN to enable ingestion</label
						>
						<Input
							id="confirm-ingestion"
							class="mt-2"
							bind:value={confirmationText}
							autocomplete="off"
						/>
					</div>
				</Card.Content>
				<Card.Footer class="justify-end gap-2">
					<Button variant="outline" onclick={() => (showConfirmation = false)}>Cancel</Button>
					<Button
						variant="destructive"
						disabled={confirmationText !== 'RUN'}
						onclick={confirmIngestion}
					>
						<DatabaseIcon /> Ingest data
					</Button>
				</Card.Footer>
			</Card.Root>
		</div>
	{/if}
</section>
