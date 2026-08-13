<script lang="ts">
	import BookmarkIcon from '@lucide/svelte/icons/bookmark';
	import FileCode2Icon from '@lucide/svelte/icons/file-code-2';
	import SearchIcon from '@lucide/svelte/icons/search';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import type { ExplorerQuery } from './database-explorer/cluster-explorer-types';

	type SavedQueriesPageProps = {
		queries: ExplorerQuery[];
		onopen: (query: ExplorerQuery) => void;
		delete?: (query: ExplorerQuery) => void;
	};

	let { queries, onopen, delete: ondelete }: SavedQueriesPageProps = $props();
	let filter = $state('');
	const filteredQueries = $derived(
		queries.filter((query) => {
			const term = filter.trim().toLowerCase();
			if (!term) return true;
			return `${query.name} ${query.database} ${query.query}`.toLowerCase().includes(term);
		})
	);
</script>

<section class="min-h-0 flex flex-1 flex-col overflow-hidden border-t">
	<div
		class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3 sm:px-5"
	>
		<div class="min-w-0">
			<p class="text-sm font-medium text-foreground">Saved for this cluster</p>
			<p class="text-muted-foreground text-xs">
				{queries.length}
				{queries.length === 1 ? 'query' : 'queries'} available
			</p>
		</div>
		<div class="relative w-full sm:w-72">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input bind:value={filter} class="h-8 pl-8" placeholder="Filter saved queries" />
		</div>
	</div>

	<ScrollArea class="min-h-0 flex-1" orientation="vertical" type="auto">
		{#if filteredQueries.length}
			<div class="divide-y">
				{#each filteredQueries as query (query.id ?? `${query.database}:${query.name}`)}
					<article
						class="group grid gap-3 px-4 py-4 transition-colors hover:bg-muted/35 sm:px-5 lg:grid-cols-[minmax(11rem,0.7fr)_minmax(20rem,1.7fr)_auto] lg:items-center lg:gap-6"
					>
						<div class="flex min-w-0 items-start gap-3">
							<BookmarkIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							<div class="min-w-0">
								<h2 class="truncate text-sm font-medium text-foreground">{query.name}</h2>
								<p class="mt-1 truncate font-mono text-xs text-muted-foreground">
									DB: {query.database}
								</p>
							</div>
						</div>

						<pre
							class="line-clamp-2 min-w-0 rounded-sm bg-muted/50 px-3 py-2 font-mono text-xs leading-5 text-muted-foreground whitespace-pre-wrap">{query.query}</pre>

						<div
							class="flex items-center justify-end gap-2 lg:opacity-70 lg:group-hover:opacity-100"
						>
							{#if query.id}
								<Button
									size="icon-sm"
									variant="ghost"
									class="text-destructive hover:bg-destructive/10 hover:text-destructive"
									aria-label={`Delete ${query.name}`}
									title={`Delete ${query.name}`}
									onclick={() => ondelete?.(query)}
								>
									<Trash2Icon />
								</Button>
							{/if}
							<Button size="sm" variant="outline" onclick={() => onopen(query)}>
								<FileCode2Icon />
								Open query
							</Button>
						</div>
					</article>
				{/each}
			</div>
		{:else}
			<div class="grid min-h-64 place-items-center px-4 text-center">
				<div class="max-w-sm">
					<BookmarkIcon class="mx-auto size-5 text-muted-foreground" />
					<p class="mt-3 text-sm font-medium text-foreground">
						{filter ? 'No matching queries' : 'No saved queries'}
					</p>
					<p class="mt-1 text-sm text-muted-foreground">
						{filter
							? 'Try a different name, database, or KQL term.'
							: 'Save a query from the editor to find it here.'}
					</p>
				</div>
			</div>
		{/if}
	</ScrollArea>
</section>
