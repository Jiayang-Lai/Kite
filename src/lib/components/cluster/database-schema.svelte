<script lang="ts">
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SquareFunctionIcon from '@lucide/svelte/icons/square-function';
	import TablePropertiesIcon from '@lucide/svelte/icons/table-properties';
	import type { Snippet } from 'svelte';

	import type {
		ExplorerExpansionChange,
		ExplorerExpansionState
	} from '$lib/cluster/cluster-session.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import type {
		KustoColumn,
		KustoDatabase,
		KustoFunction,
		KustoTable
	} from '$lib/types/kusto-schema';
	import { cn } from '$lib/utils';

	type DatabaseSchemaProps = {
		/** Database whose tables and columns are displayed. */
		database: KustoDatabase;
		/** Table selected in the explorer; when set, the panel focuses exclusively on that table. */
		selectedTable?: string;
		/** Stored function selected in the explorer; when set, the panel shows its definition. */
		selectedFunction?: string;
		/** Additional CSS classes applied to the component container. */
		class?: string;
		/** Height of the shadcn scroll area containing the table list. */
		height?: string;
		/** Optional actions shown beside the schema controls in the header. */
		headerActions?: Snippet;
		/** Optional admin actions rendered within each expanded table card. */
		tableActions?: Snippet<[KustoTable]>;
		/** Optional admin actions rendered beside each column type. */
		columnActions?: Snippet<[KustoTable, KustoColumn]>;
		/** Cluster-scoped expansion state shared across Admin and Query routes. */
		expansionState: ExplorerExpansionState;
		/** Updates the shared expansion state after a table card is toggled. */
		onexpansionchange: (change: ExplorerExpansionChange) => void;
	};

	let {
		database,
		selectedTable = $bindable(),
		selectedFunction = $bindable(),
		class: className = '',
		height = '480px',
		headerActions,
		tableActions,
		columnActions,
		expansionState,
		onexpansionchange
	}: DatabaseSchemaProps = $props();
	let filter = $state('');
	const expandedTables = $derived(expansionState.schemaTables[database.name] ?? {});
	const focusedFunction = $derived(
		(database.functions ?? []).find((fn) => fn.name === selectedFunction)
	);

	const allTablesExpanded = $derived(
		database.tables.length > 0 && database.tables.every((table) => expandedTables[table.name])
	);

	const filteredTables = $derived.by(() => {
		const query = filter.trim().toLowerCase();
		const visibleTables = selectedTable
			? database.tables.filter((table) => table.name === selectedTable)
			: database.tables;
		if (!query) {
			return visibleTables;
		}

		return visibleTables.flatMap((table) => {
			const tableMatches = `${table.name} ${table.docstring ?? ''}`.toLowerCase().includes(query);
			const columns = table.columns.filter((column) =>
				`${column.name} ${column.docstring ?? ''}`.toLowerCase().includes(query)
			);

			if (!tableMatches && columns.length === 0) {
				return [];
			}

			return [{ ...table, columns: tableMatches ? table.columns : columns }];
		});
	});

	$effect(() => {
		if (selectedTable && !database.tables.some((table) => table.name === selectedTable)) {
			selectedTable = undefined;
		}
	});

	$effect(() => {
		if (
			selectedFunction &&
			!(database.functions ?? []).some((fn) => fn.name === selectedFunction)
		) {
			selectedFunction = undefined;
		}
	});

	function isTableExpanded(tableName: string) {
		return (
			selectedTable === tableName || Boolean(filter.trim()) || Boolean(expandedTables[tableName])
		);
	}

	function toggleTable(tableName: string) {
		onexpansionchange({
			type: 'schema-table',
			database: database.name,
			table: tableName,
			open: !expandedTables[tableName]
		});
	}

	function toggleAllTables() {
		const open = !allTablesExpanded;
		for (const table of database.tables) {
			onexpansionchange({
				type: 'schema-table',
				database: database.name,
				table: table.name,
				open
			});
		}
	}

	function showAllObjects() {
		selectedTable = undefined;
		selectedFunction = undefined;
	}

	function getFunctionSignature(fn: KustoFunction) {
		const parameters = fn.inputParameters.map((parameter) => {
			const type = parameter.cslType ?? parameter.type ?? 'dynamic';
			const defaultValue = parameter.cslDefaultValue ? ` = ${parameter.cslDefaultValue}` : '';
			return `${parameter.name}: ${type}${defaultValue}`;
		});

		return `${fn.name}(${parameters.join(', ')})`;
	}

	function getHighlightedSegments(text: string) {
		const query = filter.trim();
		if (!query) {
			return [{ text, highlighted: false }];
		}

		const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const matches = new RegExp(`(${escapedQuery})`, 'gi');
		return text
			.split(matches)
			.filter(Boolean)
			.map((segment) => ({
				text: segment,
				highlighted: segment.toLowerCase() === query.toLowerCase()
			}));
	}
</script>

{#snippet highlightedText(text: string)}
	{#each getHighlightedSegments(text) as segment}
		{#if segment.highlighted}
			<mark class="bg-primary/20 text-foreground rounded-sm px-0.5">{segment.text}</mark>
		{:else}
			{segment.text}
		{/if}
	{/each}
{/snippet}

<section
	class={cn(
		'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-background shadow-xs',
		className
	)}
	aria-label={`${database.name} database schema`}
>
	<header class="shrink-0 border-b p-3 sm:p-4">
		<div class="flex items-start justify-between gap-3">
			<div class="flex min-w-0 items-center gap-2">
				{#if focusedFunction}
					<SquareFunctionIcon class="text-muted-foreground size-4 shrink-0" />
				{:else}
					<DatabaseIcon class="text-muted-foreground size-4 shrink-0" />
				{/if}
				<div class="min-w-0">
					<h2 class="truncate text-sm font-semibold">{database.name}</h2>
					<p class="text-muted-foreground text-xs">
						{selectedFunction ??
							selectedTable ??
							`${database.tables.length} ${database.tables.length === 1 ? 'table' : 'tables'} · ${database.functions?.length ?? 0} ${(database.functions?.length ?? 0) === 1 ? 'function' : 'functions'}`}
					</p>
				</div>
			</div>
			<div class="flex shrink-0 items-center gap-1.5">
				{@render headerActions?.()}
				{#if filter.trim() && !focusedFunction}
					<Badge variant="outline">Matches expanded</Badge>
				{:else if selectedTable || selectedFunction}
					<Button variant="ghost" size="sm" onclick={showAllObjects}>Show all</Button>
				{:else}
					<Button variant="ghost" size="sm" onclick={toggleAllTables}>
						{allTablesExpanded ? 'Collapse all' : 'Expand all'}
					</Button>
				{/if}
			</div>
		</div>

		{#if !focusedFunction}
			<div class="relative mt-3 sm:mt-4">
				<SearchIcon
					class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
				/>
				<Input bind:value={filter} class="pl-9" placeholder="Filter tables or columns" />
			</div>
		{/if}
	</header>

	<ScrollArea
		class="min-h-0 flex-1 overflow-hidden"
		orientation="vertical"
		style={`height: ${height};`}
		type="auto"
	>
		<div class="space-y-2.5 p-3 sm:space-y-3 sm:p-4">
			{#if focusedFunction}
				<article class="min-w-0 overflow-hidden rounded-lg border bg-muted/20">
					<div class="border-b p-3">
						<div class="flex min-w-0 items-center gap-2">
							<SquareFunctionIcon class="text-muted-foreground size-4 shrink-0" />
							<h3 class="min-w-0 break-all font-mono text-sm font-semibold">
								{focusedFunction.name}
							</h3>
							<Badge variant="secondary" class="ml-auto shrink-0">Stored function</Badge>
						</div>
						{#if focusedFunction.docstring}
							<p class="text-muted-foreground mt-2 text-xs">{focusedFunction.docstring}</p>
						{/if}
					</div>

					<div class="space-y-4 p-3">
						<section aria-labelledby="function-signature-heading">
							<h4
								id="function-signature-heading"
								class="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wider uppercase"
							>
								Signature
							</h4>
							<code class="block overflow-x-auto rounded-md border bg-background p-2 text-xs">
								{getFunctionSignature(focusedFunction)}
							</code>
						</section>

						<section aria-labelledby="function-parameters-heading">
							<h4
								id="function-parameters-heading"
								class="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wider uppercase"
							>
								Parameters
							</h4>
							{#if focusedFunction.inputParameters.length}
								<dl class="divide-y rounded-md border bg-background">
									{#each focusedFunction.inputParameters as parameter (parameter.name)}
										<div class="min-w-0 px-2.5 py-2">
											<div class="flex min-w-0 items-center gap-2">
												<dt class="min-w-0 flex-1 break-all font-mono text-xs font-medium">
													{parameter.name}
												</dt>
												<Badge variant="outline" class="shrink-0 font-mono text-[11px]">
													{parameter.cslType ?? parameter.type ?? 'dynamic'}
												</Badge>
											</div>
											{#if parameter.docstring}
												<dd class="text-muted-foreground mt-1 text-xs">{parameter.docstring}</dd>
											{/if}
											{#if parameter.cslDefaultValue}
												<dd class="text-muted-foreground mt-1 text-[11px]">
													Default: <code>{parameter.cslDefaultValue}</code>
												</dd>
											{/if}
										</div>
									{/each}
								</dl>
							{:else}
								<p class="text-muted-foreground text-xs">This function has no parameters.</p>
							{/if}
						</section>

						<section aria-labelledby="function-body-heading">
							<h4
								id="function-body-heading"
								class="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wider uppercase"
							>
								Body
							</h4>
							<pre
								class="overflow-x-auto rounded-md border bg-background p-2 whitespace-pre-wrap"><code
									class="text-xs">{focusedFunction.body}</code
								></pre>
						</section>
					</div>
				</article>
			{:else}
				{#each filteredTables as table (table.name)}
					{@const expanded = isTableExpanded(table.name)}
					<article
						class={cn(
							'min-w-0 overflow-hidden rounded-lg border bg-muted/20',
							selectedTable === table.name && 'ring-primary/20 ring-2'
						)}
					>
						<button
							type="button"
							class="hover:bg-muted/60 focus-visible:ring-ring/50 flex w-full min-w-0 items-center gap-2 p-2.5 text-left transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-default disabled:hover:bg-transparent sm:p-3"
							aria-expanded={expanded}
							disabled={Boolean(filter.trim())}
							onclick={() => toggleTable(table.name)}
						>
							<ChevronRightIcon
								class={cn(
									'text-muted-foreground size-4 shrink-0 transition-transform',
									expanded && 'rotate-90'
								)}
							/>
							<TablePropertiesIcon class="text-muted-foreground size-4 shrink-0" />
							<h3 class="min-w-0 flex-1 break-all font-mono text-sm font-medium">
								{@render highlightedText(table.name)}
							</h3>
							<Badge variant="secondary" class="shrink-0">
								{table.columns.length}
								{table.columns.length === 1 ? 'column' : 'columns'}
							</Badge>
						</button>

						{#if expanded}
							<div class="border-t p-2.5 sm:p-3">
								{#if table.docstring || tableActions}
									<div class="mb-2.5 flex items-start justify-between gap-3">
										{#if table.docstring}
											<p class="text-muted-foreground min-w-0 text-xs">
												{@render highlightedText(table.docstring)}
											</p>
										{:else}
											<span></span>
										{/if}
										<div class="shrink-0">
											{@render tableActions?.(table)}
										</div>
									</div>
								{/if}

								<dl class="min-w-0 divide-y rounded-md border bg-background">
									{#each table.columns as column (column.name)}
										<div
											class="flex min-w-0 flex-col items-start gap-1.5 px-2.5 py-2 min-[380px]:flex-row min-[380px]:justify-between min-[380px]:gap-3 sm:px-3"
										>
											<div class="min-w-0">
												<dt class="break-all font-mono text-xs font-medium">
													{@render highlightedText(column.name)}
												</dt>
												{#if column.docstring}
													<dd class="text-muted-foreground mt-0.5 text-xs">
														{@render highlightedText(column.docstring)}
													</dd>
												{/if}
											</div>
											<div class="flex shrink-0 items-center gap-1">
												<Badge variant="outline" class="font-mono text-[11px]">
													{column.type}
												</Badge>
												{@render columnActions?.(table, column)}
											</div>
										</div>
									{/each}
								</dl>
							</div>
						{/if}
					</article>
				{:else}
					<p class="text-muted-foreground py-8 text-center text-sm">
						{#if filter.trim()}
							No tables or columns match “{filter}”.
						{:else}
							This database has no tables.
						{/if}
					</p>
				{/each}
			{/if}
		</div>
	</ScrollArea>
</section>
