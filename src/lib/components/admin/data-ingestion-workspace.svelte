<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import CloudDownloadIcon from '@lucide/svelte/icons/cloud-download';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FileUpIcon from '@lucide/svelte/icons/file-up';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import PlayIcon from '@lucide/svelte/icons/play';
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import ListPlusIcon from '@lucide/svelte/icons/list-plus';
	import ServerIcon from '@lucide/svelte/icons/server';
	import TablePropertiesIcon from '@lucide/svelte/icons/table-properties';
	import XIcon from '@lucide/svelte/icons/x';
	import { onDestroy } from 'svelte';

	import EmulatedStorageBadge from '$lib/components/cluster/emulated-storage-badge.svelte';
	import QueryResults from '$lib/components/query/query-results.svelte';
	import * as Alert from '$lib/components/ui/alert';
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
		createDataIngestionController,
		INLINE_DATA_MAX_LENGTH
	} from '$lib/admin/data-ingestion-controller.svelte';
	import { EMULATION_MAX_FILE_BYTES } from '$lib/admin/inline-file-ingestion';
	import { formatBytes } from '$lib/kusto/inline-file';
	import type { EmulatedStorage } from '$lib/emulation/storage';
	import { type KustoIngestionConfiguration } from '$lib/cluster/connections';
	import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
	import type { PaneAPI } from 'paneforge';

	type DataIngestionWorkspaceProps = {
		databases?: KustoDatabaseSchema;
		selectedDatabase: string;
		selectedTable?: string;
		clusterId: string;
		clusterUrl: string;
		clusterName: string;
		ingestion?: KustoIngestionConfiguration;
		emulatedStorage?: EmulatedStorage;
		isMockCluster?: boolean;
		isEmulatedCluster?: boolean;
		ingestionEnabled?: boolean;
		isLoading?: boolean;
	};

	let {
		databases,
		selectedDatabase = $bindable(),
		selectedTable = $bindable(),
		clusterId,
		clusterUrl,
		clusterName,
		ingestion,
		emulatedStorage,
		isMockCluster = false,
		isEmulatedCluster = false,
		ingestionEnabled = false,
		isLoading = false
	}: DataIngestionWorkspaceProps = $props();
	const isPersistentEmulatedCluster = $derived(
		isEmulatedCluster && emulatedStorage?.mode === 'opfs'
	);
	const flow = createDataIngestionController(() => ({
		databases,
		selectedDatabase,
		selectedTable,
		clusterId,
		clusterUrl,
		ingestion,
		isEmulatedCluster
	}));
	let resultsCollapsed = $state(false);
	let resultsPane = $state<PaneAPI>();

	const databaseNames = $derived(Object.values(databases ?? {}).map((database) => database.name));
	const tableEntries = $derived(
		(selectedDatabase ? databases?.[selectedDatabase] : undefined)?.tables ?? []
	);

	// Keep the bound selection valid for the loaded schema.
	$effect(() => {
		if (!databaseNames.length) return;
		if (!databaseNames.includes(selectedDatabase)) selectedDatabase = databaseNames[0];
	});

	$effect(() => {
		const firstTable = tableEntries[0];
		if (firstTable && !tableEntries.some((table) => table.name === selectedTable)) {
			selectedTable = firstTable.name;
		} else if (!firstTable) {
			selectedTable = undefined;
		}
	});

	function setResultsCollapsed(collapsed: boolean) {
		resultsCollapsed = collapsed;
		if (collapsed) {
			resultsPane?.collapse();
		} else {
			resultsPane?.expand();
		}
	}

	onDestroy(() => flow.dispose());
</script>

<section class="relative flex min-h-0 flex-1 flex-col">
	{#if !ingestionEnabled}
		<section class="grid min-h-0 flex-1 place-items-center p-6">
			<Alert.Root class="w-full max-w-lg !rounded-none !border-0 bg-transparent !shadow-none">
				<ServerIcon class="text-muted-foreground" />
				<Alert.Title>Data ingestion needs a configured Kustainer connection</Alert.Title>
				<Alert.Description class="leading-6">
					{isMockCluster
						? 'Cluster type of mock does not support ingestion.'
						: 'This connection does not declare a mounted ingestion directory.'}
				</Alert.Description>
			</Alert.Root>
		</section>
	{:else if !databaseNames.length}
		<Card.Root class="min-h-0 flex-1 bg-background shadow-xs">
			<Card.Content
				class="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground"
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
			class="min-h-0 flex-1 overflow-hidden border bg-background shadow-xs"
		>
			<Resizable.Pane defaultSize={66} minSize={30}>
				<div class="flex h-full min-h-0 flex-col bg-background">
					<div class="border-b px-2 py-2 sm:px-3 sm:py-3">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div>
								<h2 class="font-semibold">Ingest into an existing table</h2>
								<p class="mt-1 text-sm text-muted-foreground">
									Direct ingestion appends data to the selected
									{isEmulatedCluster ? 'browser DuckDB' : 'Kustainer'} table.
									{#if isEmulatedCluster}
										<span
											class={isPersistentEmulatedCluster
												? 'mt-1 block text-primary'
												: 'mt-1 block text-amber-700 dark:text-amber-300'}
										>
											{isPersistentEmulatedCluster
												? 'Emulated data is stored privately by this site and restored after a full page reload.'
												: 'Emulated data is held in WASM memory and is cleared by a full page reload.'}
										</span>
									{:else if selectedDatabase === 'NetDefaultDB'}
										<span class="mt-1 block text-amber-700 dark:text-amber-300">
											Data in NetDefaultDB is stored inside the Kustainer container and will be lost
											if the container is destroyed. It is highly recommended to create a new
											database at a mounted volume for persistent data.
										</span>
									{/if}
								</p>
							</div>
							{#if isEmulatedCluster}
								<EmulatedStorageBadge storage={emulatedStorage} />
							{/if}
						</div>
					</div>
					<Resizable.PaneGroup
						direction="horizontal"
						autoSaveId="kite-admin-ingestion-source-layout"
						class="min-h-0 flex-1"
					>
						<Resizable.Pane defaultSize={75} minSize={45}>
							<div class="flex h-full min-h-0 min-w-0 flex-col">
								<div class="min-h-0 flex-1 space-y-4 overflow-auto p-2 sm:p-3">
									<div class="grid gap-3 sm:grid-cols-2">
										<div>
											<label class="text-sm font-medium" for="ingestion-database">Database</label>
											<Select.Root
												type="single"
												bind:value={selectedDatabase}
												disabled={flow.isRunning}
											>
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
												disabled={flow.isRunning || !tableEntries.length}
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

									<Tabs.Root bind:value={flow.form.sourceMode}>
										<Tabs.List>
											<Tabs.Trigger value="inline" disabled={flow.isRunning}
												><FileTextIcon /> Inline CSV</Tabs.Trigger
											>
											<Tabs.Trigger value="inline-file" disabled={flow.isRunning}
												><FileUpIcon />
												{isEmulatedCluster ? 'Local file' : 'Inline file'}</Tabs.Trigger
											>
											{#if !isEmulatedCluster}
												<Tabs.Trigger value="file" disabled={flow.isRunning}
													><FolderOpenIcon /> Mounted file</Tabs.Trigger
												>
											{/if}
											<Tabs.Trigger value="remote-file" disabled={flow.isRunning}
												><CloudDownloadIcon /> Remote file</Tabs.Trigger
											>
										</Tabs.List>

										<Tabs.Content value="inline" class="space-y-2">
											<div class="flex items-center justify-between gap-3">
												<label class="text-sm font-medium" for="inline-ingestion-data"
													>CSV rows</label
												>
												<span class="text-xs text-muted-foreground tabular-nums">
													{flow.form.inlineData.length.toLocaleString()} / {INLINE_DATA_MAX_LENGTH.toLocaleString()}
												</span>
											</div>
											<Textarea
												id="inline-ingestion-data"
												bind:value={flow.form.inlineData}
												maxlength={INLINE_DATA_MAX_LENGTH}
												disabled={flow.isRunning}
												class="min-h-40 resize-y font-mono text-xs"
												placeholder={'2026-07-22T12:00:00Z,sensor-1,temperature,21.5\n2026-07-22T12:01:00Z,sensor-2,humidity,45.2'}
											/>
											<label class="flex w-fit items-center gap-2 text-sm">
												<input
													id="inline-data-has-header"
													type="checkbox"
													bind:checked={flow.form.inlineDataHasHeader}
													disabled={flow.isRunning}
													class="size-4 rounded border border-input accent-primary"
												/>
												First row contains column names
											</label>
											<p class="text-xs text-muted-foreground">
												Values are parsed as CSV in the table column order. When enabled, the first
												row is used for comparison and excluded from ingestion.
											</p>
											{#if flow.inlineDataScanning}
												<p class="text-xs text-muted-foreground" aria-live="polite">
													Checking CSV shape…
												</p>
											{:else if flow.inlineDataScanError}
												<p class="flex items-center gap-2 text-xs text-destructive" role="alert">
													<CircleAlertIcon class="size-4 shrink-0" />
													{flow.inlineDataScanError}
												</p>
											{/if}
										</Tabs.Content>

										<Tabs.Content value="inline-file" class="space-y-3">
											<div>
												<label class="text-sm font-medium" for="inline-file-input">
													{isEmulatedCluster ? 'CSV or Parquet file' : 'CSV file'}
												</label>
												<Input
													id="inline-file-input"
													type="file"
													accept={isEmulatedCluster
														? '.csv,.parquet,text/csv,application/vnd.apache.parquet'
														: '.csv,text/csv'}
													bind:files={flow.form.selectedFiles}
													onchange={flow.selectInlineFile}
													disabled={flow.isRunning}
													class="mt-1"
												/>
											</div>

											{#if !isEmulatedCluster || flow.localFileFormat !== 'parquet'}
												<label class="flex w-fit items-center gap-2 text-sm">
													<input
														type="checkbox"
														bind:checked={flow.form.inlineFileHasHeader}
														disabled={flow.isRunning}
														class="size-4 rounded border border-input accent-primary"
													/>
													First row contains column names
												</label>
											{/if}

											{#if flow.inlineFileState === 'scanning'}
												<div class="space-y-2 rounded-md border p-3" aria-live="polite">
													<div class="flex items-center justify-between gap-3 text-xs">
														<span>Scanning {flow.inlineFile?.name}</span>
														<span class="text-muted-foreground tabular-nums"
															>{flow.inlineFileScanProgress}%</span
														>
													</div>
													<div class="h-1.5 overflow-hidden rounded-full bg-muted">
														<div
															class="h-full bg-primary transition-[width]"
															style:width={`${flow.inlineFileScanProgress}%`}
														></div>
													</div>
												</div>
											{:else if flow.inlineFile && (flow.inlineFilePlan || (isEmulatedCluster && flow.localFileFormat === 'parquet'))}
												<div class="space-y-3 rounded-md border p-3">
													<div class="flex flex-wrap items-center justify-between gap-2">
														<div class="min-w-0">
															<p class="truncate text-sm font-medium">{flow.inlineFile.name}</p>
															<p class="text-xs text-muted-foreground">
																{formatBytes(flow.inlineFile.size)} ·
																{flow.localFileFormat === 'parquet' ? 'Parquet' : 'UTF-8 CSV'}
															</p>
														</div>
														<Badge
															variant={flow.inlineFileState === 'succeeded'
																? 'secondary'
																: flow.inlineFileState === 'failed'
																	? 'destructive'
																	: 'outline'}
														>
															{flow.inlineFileStatusLabel}
														</Badge>
													</div>
													{#if flow.inlineFilePlan}
														<dl class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
															<div class="rounded-md bg-muted p-2">
																<dt class="text-muted-foreground">Rows</dt>
																<dd class="mt-1 font-medium tabular-nums">
																	{flow.inlineFilePlan.totalRecords.toLocaleString()}
																</dd>
															</div>
															<div class="rounded-md bg-muted p-2">
																<dt class="text-muted-foreground">Columns</dt>
																<dd class="mt-1 font-medium tabular-nums">
																	{flow.inlineFilePlan.columnCount}
																</dd>
															</div>
															<div class="rounded-md bg-muted p-2">
																<dt class="text-muted-foreground">
																	{isEmulatedCluster ? 'Format' : 'Chunks'}
																</dt>
																<dd class="mt-1 font-medium tabular-nums">
																	{isEmulatedCluster ? 'CSV' : flow.inlineFilePlan.chunks.length}
																</dd>
															</div>
															<div class="rounded-md bg-muted p-2">
																<dt class="text-muted-foreground">Data</dt>
																<dd class="mt-1 font-medium tabular-nums">
																	{formatBytes(flow.inlineFilePlan.dataBytes)}
																</dd>
															</div>
														</dl>
													{/if}
													{#if flow.inlineFilePlan?.header}
														<p
															class="truncate text-xs text-muted-foreground"
															title={flow.inlineFilePlan.header}
														>
															Header: <code>{flow.inlineFilePlan.header}</code>
														</p>
													{/if}
													{#if !isEmulatedCluster && flow.inlineFilePlan && (flow.inlineFileState === 'running' || flow.completedFileChunks > 0)}
														<div class="space-y-2 border-t pt-3" aria-live="polite">
															<div class="flex items-center justify-between gap-3 text-xs">
																<span>
																	{flow.inlineFileState === 'running' &&
																	flow.activeFileChunk !== undefined
																		? `Ingesting chunk ${flow.activeFileChunk + 1} of ${flow.inlineFilePlan.chunks.length}`
																		: `${flow.completedFileChunks} of ${flow.inlineFilePlan.chunks.length} chunks completed`}
																</span>
																<span class="text-muted-foreground tabular-nums"
																	>{flow.fileExecutionProgress}%</span
																>
															</div>
															<div class="h-1.5 overflow-hidden rounded-full bg-muted">
																<div
																	class="h-full bg-primary transition-[width]"
																	style:width={`${flow.fileExecutionProgress}%`}
																></div>
															</div>
															<p class="text-xs text-muted-foreground">
																{flow.completedFileRecords.toLocaleString()} rows confirmed
																{#if flow.extentIds.length}
																	· {flow.extentIds.length} extents returned{/if}
															</p>
														</div>
													{/if}
												</div>
											{:else if flow.inlineFileError}
												<div class="space-y-2">
													<p
														class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
														role="alert"
													>
														<CircleAlertIcon class="size-4 shrink-0" />
														{flow.inlineFileError}
													</p>
													{#if flow.inlineFile}
														<Button variant="outline" size="sm" onclick={flow.rescanInlineFile}
															>Scan again</Button
														>
													{/if}
												</div>
											{:else}
												<p class="text-xs text-muted-foreground">
													{#if isEmulatedCluster}
														DuckDB reads the selected file directly in this browser tab. Limit:
														{formatBytes(EMULATION_MAX_FILE_BYTES)}.
													{:else if ingestion}
														The file stays in the browser and is sent sequentially as record-safe
														inline commands. Limit: {formatBytes(ingestion.maxInlineFileBytes)}.
													{/if}
												</p>
											{/if}
										</Tabs.Content>

										{#if !isEmulatedCluster && ingestion}
											<Tabs.Content value="file" class="space-y-3">
												<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
													<div>
														<label class="text-sm font-medium" for="mounted-file-path"
															>Relative file path</label
														>
														<Input
															id="mounted-file-path"
															bind:value={flow.form.relativePath}
															disabled={flow.isRunning}
															class="mt-1 font-mono"
															placeholder="import.parquet"
														/>
													</div>
													<div>
														<label class="text-sm font-medium" for="mounted-file-format"
															>Format</label
														>
														<Select.Root
															type="single"
															bind:value={flow.form.fileFormat}
															disabled={flow.isRunning}
														>
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
												<div class="rounded-md bg-muted p-3 text-xs">
													<p class="text-muted-foreground">Kustainer source path</p>
													<code class="mt-1 block break-all"
														>{flow.resolvedFilePath || `${ingestion.containerRoot}/…`}</code
													>
												</div>
												<p class="text-xs text-muted-foreground">
													The file must already exist below <code>{ingestion.containerRoot}</code> inside
													the container.
												</p>
											</Tabs.Content>
										{/if}

										<Tabs.Content value="remote-file" class="space-y-3">
											<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
												<div>
													<label class="text-sm font-medium" for="remote-file-url">File URL</label>
													<Input
														id="remote-file-url"
														type="url"
														bind:value={flow.form.remoteFileUrl}
														disabled={flow.isRunning}
														class="mt-1 font-mono"
														placeholder="https://example.com/import.csv"
														autocomplete="url"
													/>
												</div>
												<div>
													<label class="text-sm font-medium" for="remote-file-format">Format</label>
													<Select.Root
														type="single"
														bind:value={flow.form.remoteFileFormat}
														disabled={flow.isRunning}
													>
														<Select.Trigger id="remote-file-format" class="mt-1 w-full">
															<Select.Value />
														</Select.Trigger>
														<Select.Content>
															<Select.Item value="parquet" label="Parquet" />
															<Select.Item value="csv" label="CSV" />
														</Select.Content>
													</Select.Root>
												</div>
											</div>
											{#if flow.form.remoteFileFormat === 'csv'}
												<label class="flex w-fit items-center gap-2 text-sm">
													<input
														type="checkbox"
														bind:checked={flow.form.remoteFileSkipFirstLine}
														disabled={flow.isRunning}
														class="size-4 rounded border border-input accent-primary"
													/>
													Skip first line
												</label>
											{/if}
											<div class="rounded-md bg-muted p-3 text-xs">
												<p class="text-muted-foreground">Remote source</p>
												<code class="mt-1 block break-all"
													>{flow.resolvedRemoteFileUrl || 'https://…'}</code
												>
											</div>
											<p class="text-xs text-muted-foreground">
												Import a CSV or Parquet file from a public HTTP(S) URL, or use a signed URL
												when the source requires temporary read access.
												{#if isEmulatedCluster}
													The server must allow browser CORS and range requests.
												{/if}
											</p>
										</Tabs.Content>
									</Tabs.Root>

									{#if flow.preparedCommand.error && flow.hasSourceInput}
										<p class="flex items-center gap-2 text-xs text-destructive" role="alert">
											<CircleAlertIcon class="size-4 shrink-0" />
											{flow.preparedCommand.error}
										</p>
									{/if}
									{#if flow.activeGuardrails.length}
										<Alert.Root class="!rounded-none !border-0 bg-transparent !shadow-none">
											<CircleAlertIcon class="text-warning" />
											<Alert.Title>Source shape differs from the target</Alert.Title>
											<Alert.Description>
												{flow.activeCsvPlan?.columnCount ?? 0} source columns; the target table has
												{flow.activeTable?.columns.length ?? 0}.
											</Alert.Description>
										</Alert.Root>
									{:else if flow.sourceShapeCheckUnavailable && flow.hasSourceInput}
										<p class="text-xs text-muted-foreground">
											Source shape cannot be checked before ingestion because this file is read by
											Kustainer, not the browser.
										</p>
									{/if}
								</div>

								<div
									class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background px-2 py-3 sm:px-3"
								>
									<p class="text-xs text-muted-foreground">
										Runs against <span class="font-medium text-foreground">{clusterName}</span>.
										Data is appended.
									</p>
									{#if flow.isRunning}
										<Button variant="outline" size="sm" onclick={flow.cancelIngestion}>
											<CircleStopIcon /> Stop waiting
										</Button>
									{:else if flow.form.sourceMode === 'inline-file' && flow.inlineFileState === 'scanning'}
										<Button variant="outline" size="sm" onclick={flow.cancelIngestion}>
											<CircleStopIcon /> Cancel scan
										</Button>
									{:else}
										<Button size="sm" disabled={!flow.canIngest} onclick={flow.requestIngestion}>
											<PlayIcon />
											{flow.form.sourceMode === 'inline-file' && flow.completedFileChunks
												? 'Review retry'
												: 'Review ingestion'}
										</Button>
									{/if}
								</div>
							</div>
						</Resizable.Pane>

						<Resizable.Handle />

						<Resizable.Pane defaultSize={25} minSize={15}>
							<aside class="flex h-full min-h-0 flex-col border">
								<div class="flex items-center gap-2 border-b p-3">
									<TablePropertiesIcon class="size-4 text-muted-foreground" />
									<div class="min-w-0">
										<p class="truncate text-sm font-medium">
											{flow.activeTable?.name ?? 'Select a table'}
										</p>
										<p class="text-xs text-muted-foreground">Target column order</p>
									</div>
								</div>
								<ScrollArea class="min-h-0 flex-1" orientation="vertical" type="auto">
									{#if flow.activeTable?.columns.length}
										<ol class="divide-y">
											{#each flow.activeTable.columns as column, index (`${column.name}:${index}`)}
												<li
													class={`grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 px-3 py-2 text-xs ${flow.targetColumnShapeWarnings[index] ? 'bg-amber-500/10' : ''}`}
												>
													<span class="text-right text-muted-foreground tabular-nums"
														>{index + 1}</span
													>
													<span class="min-w-0">
														<span class="block truncate font-medium">{column.name}</span>
														<span class="font-mono text-muted-foreground">{column.type}</span>
														{#if flow.targetColumnShapeWarnings[index]}
															<span
																class="mt-1 flex items-start gap-1 text-amber-800 dark:text-amber-200"
																title={flow.targetColumnShapeWarnings[index].message}
															>
																{#if flow.targetColumnShapeWarnings[index].kind === 'header-order'}
																	<ArrowLeftRightIcon class="mt-0.5 size-3 shrink-0" />
																{:else}
																	<CircleXIcon class="mt-0.5 size-3 shrink-0" />
																{/if}
																<span class="line-clamp-2"
																	>{flow.targetColumnShapeWarnings[index].message}</span
																>
															</span>
														{/if}
													</span>
												</li>
											{/each}
										</ol>
										{#if flow.extraSourceColumnCount}
											<p
												class="border-t border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
												role="alert"
											>
												<span class="flex items-center gap-1">
													<ListPlusIcon class="size-3 shrink-0" />
													+ {flow.extraSourceColumnCount} extra source column{flow.extraSourceColumnCount ===
													1
														? ''
														: 's'}
												</span>
											</p>
										{/if}
									{:else}
										<p class="p-4 text-center text-xs text-muted-foreground">
											No table columns available.
										</p>
									{/if}
								</ScrollArea>
							</aside>
						</Resizable.Pane>
					</Resizable.PaneGroup>
				</div>
			</Resizable.Pane>

			<Resizable.Handle />

			<Resizable.Pane
				bind:this={resultsPane}
				defaultSize={15}
				minSize={5}
				collapsible
				collapsedSize={5}
				onCollapse={() => (resultsCollapsed = true)}
				onExpand={() => (resultsCollapsed = false)}
			>
				<QueryResults
					class="h-full min-h-0 rounded-none border-0 bg-background"
					result={flow.result}
					error={flow.ingestionError}
					isRunning={flow.isRunning}
					collapsed={resultsCollapsed}
					oncollapsedchange={setResultsCollapsed}
					operationLabel="Data load"
				/>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	{/if}

	{#if flow.form.showConfirmation}
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
							onclick={() => (flow.form.showConfirmation = false)}
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
						<dd>{flow.confirmationSource}</dd>
						<dt class="text-muted-foreground">Mode</dt>
						<dd>Append</dd>
					</dl>
					{#if flow.activeGuardrails.length}
						<Alert.Root class="!rounded-none !border-0 bg-transparent !shadow-none">
							<CircleAlertIcon class="text-warning" />
							<Alert.Title>Review source-shape warnings before continuing</Alert.Title>
							<Alert.Description>
								<ul class="list-disc pl-5">
									{#each flow.activeGuardrails as guardrail (guardrail.id)}
										<li>{guardrail.message}</li>
									{/each}
								</ul>
							</Alert.Description>
						</Alert.Root>
					{:else if flow.sourceShapeCheckUnavailable}
						<p class="text-xs text-muted-foreground">
							Source shape was not checked; Kustainer reads this source directly.
						</p>
					{/if}
					<pre
						class="max-h-36 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{flow.pendingCommand}</pre>
					<div>
						<label class="text-sm font-medium" for="confirm-ingestion"
							>Type RUN to enable ingestion</label
						>
						<Input
							id="confirm-ingestion"
							class="mt-2"
							bind:value={flow.form.confirmationText}
							autocomplete="off"
						/>
					</div>
				</Card.Content>
				<Card.Footer class="justify-end gap-2">
					<Button variant="outline" onclick={() => (flow.form.showConfirmation = false)}
						>Cancel</Button
					>
					<Button
						variant="destructive"
						disabled={flow.form.confirmationText !== 'RUN'}
						onclick={flow.confirmIngestion}
					>
						<DatabaseIcon /> Ingest data
					</Button>
				</Card.Footer>
			</Card.Root>
		</div>
	{/if}
</section>
