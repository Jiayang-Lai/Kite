<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import Rows3Icon from '@lucide/svelte/icons/rows-3';

	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import ResultTable from '$lib/components/query/result-table.svelte';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Spinner } from '$lib/components/ui/spinner';
	import * as Tabs from '$lib/components/ui/tabs';
	import type { QueryResult } from '$lib/types/query-result';
	import { cn } from '$lib/utils';

	type QueryResultsProps = {
		/** Most recently completed primary Kusto result. */
		result?: QueryResult;
		/** Error produced by the most recent query execution. */
		error?: string;
		/** Whether a query request is currently in flight. */
		isRunning?: boolean;
		/** Whether the result drawer is reduced to its tab bar. Supports `bind:collapsed`. */
		collapsed?: boolean;
		/** Called when the user changes the collapsed state. */
		oncollapsedchange?: (collapsed: boolean) => void;
		/** Additional CSS classes applied to the result panel. */
		class?: string;
		/** Label used for the executed operation throughout the panel. */
		operationLabel?: string;
	};

	let {
		result,
		error,
		isRunning = false,
		collapsed = $bindable(false),
		oncollapsedchange,
		class: className = '',
		operationLabel = 'Query'
	}: QueryResultsProps = $props();
	let activeTab = $state('results');
	let previousError = '';

	function setCollapsed(nextCollapsed: boolean) {
		collapsed = nextCollapsed;
		oncollapsedchange?.(nextCollapsed);
	}

	$effect(() => {
		if (error && error !== previousError) {
			activeTab = 'messages';
			setCollapsed(false);
		}
		previousError = error ?? '';
	});
</script>

<Tabs.Root
	bind:value={activeTab}
	class={cn('min-h-0 overflow-hidden rounded-lg border bg-background', className)}
>
	<header
		class={cn(
			'relative z-20 flex min-w-0 shrink-0 items-center justify-between gap-2 px-2',
			collapsed ? 'h-full' : 'h-9 border-b'
		)}
	>
		<Tabs.List
			variant="line"
			class={cn('min-w-0 bg-transparent p-0', collapsed ? 'h-full' : 'h-8')}
		>
			<Tabs.Trigger value="results" class={cn('px-2 text-xs', collapsed ? 'h-full' : 'h-8')}>
				<Rows3Icon />
				Results
				{#if result && !error}<Badge variant="secondary" class="h-4 px-1 text-[9px]"
						>{result.totalRowCount}</Badge
					>{/if}
			</Tabs.Trigger>
			<Tabs.Trigger value="messages" class={cn('px-2 text-xs', collapsed ? 'h-full' : 'h-8')}>
				<CircleAlertIcon />
				Messages
				{#if error || result?.warnings.length}
					<Badge variant="outline" class="h-4 px-1 text-[9px]">
						{(error ? 1 : 0) + (result?.warnings.length ?? 0)}
					</Badge>
				{/if}
			</Tabs.Trigger>
		</Tabs.List>

		<div class="text-muted-foreground flex shrink-0 items-center gap-1 text-[10px] sm:gap-2">
			{#if isRunning}
				<Spinner class="size-3" />
				<span>Running</span>
			{:else if result && !error}
				<span class="hidden sm:inline">{Math.round(result.elapsedMs)} ms</span>
			{/if}
			<Button
				variant="ghost"
				size="icon-xs"
				onclick={() => setCollapsed(!collapsed)}
				title={collapsed ? 'Expand results drawer' : 'Collapse results drawer'}
				aria-label={collapsed ? 'Expand results drawer' : 'Collapse results drawer'}
				aria-expanded={!collapsed}
			>
				{#if collapsed}
					<ChevronUpIcon />
				{:else}
					<ChevronDownIcon />
				{/if}
			</Button>
		</div>
	</header>

	{#if !collapsed}
		<Tabs.Content value="results" class="relative min-h-0 overflow-hidden">
			{#if isRunning && !result}
				<div class="text-muted-foreground grid h-full place-items-center text-xs">
					<div class="flex items-center gap-2">
						<Spinner class="size-4" /> Running {operationLabel.toLowerCase()}…
					</div>
				</div>
			{:else if result?.columns.length}
				<ResultTable {result} />
			{:else if result}
				<div class="text-muted-foreground grid h-full place-items-center px-4 text-center text-xs">
					Query completed successfully without a tabular result.
				</div>
			{:else}
				<div class="text-muted-foreground grid h-full place-items-center px-4 text-center text-xs">
					Run a {operationLabel.toLowerCase()} to see its results.
				</div>
			{/if}
		</Tabs.Content>

		<Tabs.Content value="messages" class="min-h-0 overflow-hidden">
			<ScrollArea class="h-full" orientation="vertical" type="auto">
				<div class="space-y-3 p-3 text-xs">
					{#if error}
						<div
							class="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-2.5"
						>
							<p class="font-medium">{operationLabel} failed</p>
							<p class="mt-1 whitespace-pre-wrap">{error}</p>
						</div>
					{/if}

					{#each result?.warnings ?? [] as warning, index (index)}
						<div
							class="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-300"
						>
							{warning}
						</div>
					{/each}

					{#if result && !error}
						<dl class="text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
							<dt>Rows returned</dt>
							<dd>{result.totalRowCount}</dd>
							<dt>Rows rendered</dt>
							<dd>{result.renderedRowCount}</dd>
							<dt>Elapsed</dt>
							<dd>{Math.round(result.elapsedMs)} ms</dd>
							<dt>Request ID</dt>
							<dd class="truncate font-mono" title={result.clientRequestId}>
								{result.clientRequestId}
							</dd>
						</dl>
					{:else if !error}
						<p class="text-muted-foreground">No query messages.</p>
					{/if}
				</div>
			</ScrollArea>
		</Tabs.Content>
	{/if}
</Tabs.Root>
