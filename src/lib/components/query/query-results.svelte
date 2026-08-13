<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import Rows3Icon from '@lucide/svelte/icons/rows-3';

	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import ResultTable from '$lib/components/query/result-table.svelte';
	import { getQueryDetails } from '$lib/query/query-details';
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
		/** Azure request ID that correlates a failed Logs query with service diagnostics. */
		errorRequestId?: string;
		/** Raw Azure Logs error response retained for troubleshooting. */
		errorRaw?: unknown;
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
		errorRequestId,
		errorRaw,
		isRunning = false,
		collapsed = $bindable(false),
		oncollapsedchange,
		class: className = '',
		operationLabel = 'Query'
	}: QueryResultsProps = $props();
	let activeTab = $state('results');
	let previousError = '';
	const queryDetails = $derived(result ? getQueryDetails(result) : []);
	const rawStatistics = $derived(
		result?.statistics ? JSON.stringify(result.statistics, null, 2) : ''
	);
	const rawError = $derived(errorRaw ? JSON.stringify(errorRaw, null, 2) : '');

	function setCollapsed(nextCollapsed: boolean) {
		collapsed = nextCollapsed;
		oncollapsedchange?.(nextCollapsed);
	}

	$effect(() => {
		if (error && error !== previousError) {
			activeTab = 'results';
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
			'relative z-20 flex min-w-0 shrink-0 items-center justify-between gap-2 bg-muted/30 px-2',
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
				{#if result?.warnings.length}
					<Badge variant="outline" class="h-4 px-1 text-[9px]">
						{result.warnings.length}
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
			{#if error}
				<div class="h-full min-h-0 overflow-y-auto p-3">
					<div
						class="border-destructive/30 bg-destructive/10 text-destructive mx-auto w-full max-w-3xl rounded-md border p-3 text-xs"
					>
						<p class="font-medium">{operationLabel} failed</p>
						<p class="mt-1 whitespace-pre-wrap">{error}</p>
						{#if errorRequestId}
							<p class="mt-3 text-[11px]">
								Request ID:
								<span class="ml-1 break-all font-mono text-foreground">{errorRequestId}</span>
							</p>
						{/if}
						{#if rawError}
							<details class="mt-3 rounded border border-current/20 bg-background/50 p-2">
								<summary class="cursor-pointer font-medium">Raw error JSON</summary>
								<pre
									class="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground">{rawError}</pre>
							</details>
						{/if}
					</div>
				</div>
			{:else if isRunning && !result}
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
				<div class="space-y-4 p-3 text-xs">
					{#each result?.warnings ?? [] as warning, index (index)}
						<div
							class="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-300"
						>
							{warning}
						</div>
					{/each}

					{#if result && !error}
						<section aria-label="Query details">
							<h2 class="mb-3 text-sm font-semibold text-foreground">Query details</h2>
							<dl
								class="grid grid-cols-1 gap-x-6 gap-y-3 text-muted-foreground sm:grid-cols-2 xl:grid-cols-3"
							>
								{#each queryDetails as detail (detail.label)}
									<div class="min-w-0">
										<dt>{detail.label}</dt>
										<dd class="mt-0.5 break-words font-medium text-foreground">{detail.value}</dd>
									</div>
								{/each}
							</dl>
						</section>

						{#if rawStatistics}
							<details class="rounded-md border p-2">
								<summary class="cursor-pointer font-medium text-foreground"
									>Raw Azure statistics</summary
								>
								<pre
									class="text-muted-foreground mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px]">{rawStatistics}</pre>
							</details>
						{/if}
					{:else if !error}
						<p class="text-muted-foreground">No query messages.</p>
					{/if}
				</div>
			</ScrollArea>
		</Tabs.Content>
	{/if}
</Tabs.Root>
