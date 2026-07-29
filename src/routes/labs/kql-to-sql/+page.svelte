<script lang="ts">
	import { mode } from 'mode-watcher';
	import { onDestroy, onMount } from 'svelte';

	import MonacoEditor from '$lib/components/query/monaco-editor.svelte';
	import QueryResults from '$lib/components/query/query-results.svelte';
	import * as Resizable from '$lib/components/ui/resizable';
	import { disposeDuckDb, executeDuckDbQuery, getDuckDbCatalog } from '$lib/duckdb/query-client';
	import type { DuckDbCatalogDatabase } from '$lib/duckdb/types';
	import { disposeKqlTranslator, translateKqlToSql } from '$lib/kql/wasm-translator';
	import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
	import type { QueryResult } from '$lib/types/query-result';
	import type { PaneAPI } from 'paneforge';

	const DATABASE_NAME = 'Validation';
	const DATABASE_SCHEMA: KustoDatabaseSchema = {
		[DATABASE_NAME]: {
			name: DATABASE_NAME,
			tables: []
		}
	};

	let kql = $state(
		"datatable(State:string, Events:long) ['Texas', 12, 'Ohio', 8]\n| top 1 by Events"
	);
	let sql = $state('');
	let queryResult = $state<QueryResult>();
	let queryError = $state('');
	let isQueryRunning = $state(false);
	let resultsCollapsed = $state(false);
	let resultsPane = $state<PaneAPI>();
	let catalog = $state<DuckDbCatalogDatabase[]>([]);
	let catalogError = $state('');
	let catalogLoading = $state(true);
	let translationError = $state('');
	let translationStatus = $state('');
	let translationRequestId = 0;
	let queryRequestId = 0;
	let catalogRequestId = 0;
	const editorTheme = $derived(mode.current === 'dark' ? 'vs-dark' : 'vs');
	const translationOutput = $derived(
		[sql, translationError ? `-- Translation error\n${translationError}` : '']
			.filter(Boolean)
			.join('\n\n')
	);

	async function refreshCatalog() {
		const requestId = ++catalogRequestId;
		catalogLoading = true;
		catalogError = '';
		try {
			const databases = await getDuckDbCatalog();
			if (requestId === catalogRequestId) catalog = databases;
		} catch (cause) {
			if (requestId === catalogRequestId) {
				catalogError = cause instanceof Error ? cause.message : String(cause);
			}
		} finally {
			if (requestId === catalogRequestId) catalogLoading = false;
		}
	}

	async function translate(query: string, requestId: number) {
		if (!query.trim()) {
			sql = '';
			translationError = '';
			translationStatus = '';
			return undefined;
		}

		translationStatus = 'Translating…';
		try {
			const result = await translateKqlToSql(query);
			if (requestId !== translationRequestId) return undefined;

			if (!result.success || !result.sql) {
				sql = '';
				translationError = result.error || 'The KQL could not be translated.';
				return undefined;
			}

			sql = result.sql;
			translationError = '';
			return result.sql;
		} catch (cause) {
			if (requestId !== translationRequestId) return undefined;
			translationError = cause instanceof Error ? cause.message : String(cause);
			return undefined;
		} finally {
			if (requestId === translationRequestId) translationStatus = '';
		}
	}

	async function runQuery() {
		const query = kql;
		if (!query.trim() || isQueryRunning) return;

		const queryId = ++queryRequestId;
		const translationId = ++translationRequestId;
		queryError = '';
		queryResult = undefined;
		resultsCollapsed = false;
		resultsPane?.expand();
		isQueryRunning = true;

		try {
			const translatedSql = await translate(query, translationId);
			if (!translatedSql || queryId !== queryRequestId || query !== kql) return;

			const completedQuery = await executeDuckDbQuery(translatedSql);
			if (queryId !== queryRequestId || query !== kql) return;
			queryResult = completedQuery;
			void refreshCatalog();
		} catch (cause) {
			if (queryId === queryRequestId) {
				queryError = cause instanceof Error ? cause.message : String(cause);
			}
		} finally {
			if (queryId === queryRequestId) isQueryRunning = false;
		}
	}

	function setResultsCollapsed(collapsed: boolean) {
		resultsCollapsed = collapsed;
		if (collapsed) {
			resultsPane?.collapse();
		} else {
			resultsPane?.expand();
		}
	}

	$effect(() => {
		const query = kql;
		const requestId = ++translationRequestId;
		queryResult = undefined;
		queryError = '';
		const timeout = window.setTimeout(() => void translate(query, requestId), 250);
		return () => window.clearTimeout(timeout);
	});

	onMount(() => {
		void refreshCatalog();
	});

	onDestroy(() => {
		disposeKqlTranslator();
		void disposeDuckDb();
	});
</script>

<svelte:head><title>KQL to SQL WASM validation</title></svelte:head>

<main
	class="grid h-dvh min-h-144 grid-rows-[12rem_minmax(0,1fr)] gap-4 bg-muted/30 p-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:grid-rows-1"
>
	<h1 class="sr-only">KQL to SQL WASM validation</h1>

	<section
		class="flex min-h-48 min-w-0 flex-col gap-2 lg:min-h-0"
		aria-labelledby="catalog-heading"
	>
		<div class="flex items-center justify-between gap-2">
			<h2 id="catalog-heading" class="text-sm font-medium">Databases and tables</h2>
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline disabled:opacity-50"
				disabled={catalogLoading}
				onclick={() => void refreshCatalog()}
			>
				Refresh
			</button>
		</div>
		<div
			class="min-h-0 flex-1 overflow-auto rounded-lg border bg-background p-3 text-sm"
			aria-busy={catalogLoading}
			data-testid="duckdb-catalog"
		>
			{#if catalogError}
				<p class="text-destructive text-xs">{catalogError}</p>
			{:else if catalogLoading && catalog.length === 0}
				<p class="text-muted-foreground text-xs">Loading DuckDB catalog…</p>
			{:else if catalog.length === 0}
				<p class="text-muted-foreground text-xs">No databases found.</p>
			{:else}
				<ul class="space-y-2">
					{#each catalog as database}
						<li>
							<details open>
								<summary class="cursor-pointer font-medium">
									{database.name}
									{#if database.isCurrent}
										<span class="text-muted-foreground ml-1 text-[0.65rem] font-normal"
											>current</span
										>
									{/if}
								</summary>
								<div class="mt-1 ml-4">
									{#if database.schemas.length === 0}
										<p class="text-muted-foreground text-xs">No user tables.</p>
									{:else}
										<ul class="space-y-1">
											{#each database.schemas as schema}
												<li>
													<details open>
														<summary class="cursor-pointer text-xs font-medium"
															>{schema.name}</summary
														>
														<ul class="text-muted-foreground mt-1 ml-4 space-y-1 text-xs">
															{#each schema.tables as table}
																<li>{table}</li>
															{/each}
														</ul>
													</details>
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							</details>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>

	<div class="min-h-0 min-w-0 overflow-hidden rounded-lg border bg-background">
		<Resizable.PaneGroup direction="vertical" autoSaveId="kite-kql-lab-layout" class="min-h-0">
			<Resizable.Pane defaultSize={68} minSize={30}>
				<div class="grid h-full min-h-0 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1">
					<section
						class="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden p-3"
						aria-labelledby="kql-heading"
					>
						<div class="flex h-8 shrink-0 items-center justify-between gap-3">
							<h2 id="kql-heading" class="text-sm font-medium">KQL</h2>
							<button
								type="button"
								class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
								disabled={isQueryRunning || !kql.trim()}
								onclick={() => void runQuery()}
							>
								{isQueryRunning ? 'Running…' : 'Run query'}
							</button>
						</div>
						<MonacoEditor
							bind:value={kql}
							class="min-h-0 flex-1"
							database={DATABASE_NAME}
							databaseSchema={DATABASE_SCHEMA}
							clusterUrl="emulated://validation"
							height="100%"
							theme={editorTheme}
						/>
					</section>

					<section
						class="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden border-t p-3 lg:border-t-0 lg:border-l"
						aria-labelledby="sql-heading"
					>
						<div class="flex h-8 shrink-0 items-center justify-between gap-3">
							<h2 id="sql-heading" class="text-sm font-medium">Translated SQL</h2>
							{#if translationStatus}
								<span class="text-muted-foreground text-xs" role="status">{translationStatus}</span>
							{/if}
						</div>
						<pre
							class="min-h-0 flex-1 overflow-auto rounded-md bg-muted/30 p-3 font-mono text-sm whitespace-pre-wrap"
							aria-live="polite"
							aria-busy={Boolean(translationStatus)}
							data-testid="translation-output">{translationOutput}</pre>
					</section>
				</div>
			</Resizable.Pane>

			<Resizable.Handle />

			<Resizable.Pane
				bind:this={resultsPane}
				defaultSize={32}
				minSize={5}
				collapsible
				collapsedSize={5}
				onCollapse={() => (resultsCollapsed = true)}
				onExpand={() => (resultsCollapsed = false)}
			>
				<div class="h-full min-h-0" data-testid="duckdb-results">
					<QueryResults
						class="h-full min-h-0 rounded-none border-0"
						result={queryResult}
						error={queryError}
						isRunning={isQueryRunning}
						collapsed={resultsCollapsed}
						oncollapsedchange={setResultsCollapsed}
						operationLabel="DuckDB query"
					/>
				</div>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	</div>
</main>
