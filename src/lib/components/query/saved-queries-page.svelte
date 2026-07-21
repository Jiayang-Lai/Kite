<script lang="ts">
	import BookmarkIcon from '@lucide/svelte/icons/bookmark';
	import FileCode2Icon from '@lucide/svelte/icons/file-code-2';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import type { ExplorerQuery } from './database-explorer/cluster-explorer-types';

	type SavedQueriesPageProps = {
		queries: ExplorerQuery[];
		onopen: (query: ExplorerQuery) => void;
		delete?: (query: ExplorerQuery) => void;
	};

	let { queries, onopen, delete: ondelete }: SavedQueriesPageProps = $props();
	let queryListContainer = $state<HTMLElement>();
	let queryListHeight = $state<number>();

	$effect(() => {
		if (!queryListContainer) return;

		const resizeObserver = new ResizeObserver(([entry]) => {
			queryListHeight = Math.floor(entry.contentRect.height);
		});

		resizeObserver.observe(queryListContainer);
		return () => resizeObserver.disconnect();
	});

	function previewHeight(query: string) {
		const lineCount = query.split('\n').length;
		return `${Math.min(128, Math.max(40, lineCount * 18 + 16))}px`;
	}
</script>

<section bind:this={queryListContainer} class="-mt-2 min-h-0 flex-1 overflow-hidden">
	<ScrollArea
		class="h-full"
		orientation="vertical"
		style={queryListHeight ? `height: ${queryListHeight}px` : undefined}
		type="auto"
	>
		{#if queries.length}
			<div class="grid gap-3 p-2 pt-2 pr-3 lg:grid-cols-2">
				{#each queries as query (query.id ?? `${query.database}:${query.name}`)}
					<Card.Root class="border border-border ring-0 shadow-none">
						<Card.Header class="grid-cols-[auto_1fr] gap-x-3">
							<BookmarkIcon class="row-span-2 mt-0.5 size-5 text-muted-foreground" />
							<Card.Title class="truncate">{query.name}</Card.Title>
							<Card.Description class="truncate">{query.database}</Card.Description>
						</Card.Header>
						<Card.Content>
							<ScrollArea
								class="rounded-md bg-muted/50"
								orientation="vertical"
								style={`height: ${previewHeight(query.query)}`}
								type="auto"
							>
								<pre
									class="text-muted-foreground p-2 font-mono text-xs whitespace-pre-wrap">{query.query}</pre>
							</ScrollArea>
						</Card.Content>
						<Card.Footer class="justify-end gap-2">
							{#if query.id}
								<Button
									size="sm"
									variant="outline"
									class="text-destructive hover:bg-destructive/10 hover:text-destructive"
									onclick={() => ondelete?.(query)}
								>
									<Trash2Icon />
									Delete
								</Button>
							{/if}
							<Button size="sm" variant="outline" onclick={() => onopen(query)}>
								<FileCode2Icon />
								Open in Query
							</Button>
						</Card.Footer>
					</Card.Root>
				{/each}
			</div>
		{:else}
			<div
				class="text-muted-foreground grid h-full min-h-52 place-items-center text-center text-sm"
			>
				<div>
					<BookmarkIcon class="mx-auto mb-3 size-6" />
					<p class="font-medium text-foreground">No saved queries</p>
					<p class="mt-1">Save a query from the editor to find it here.</p>
				</div>
			</div>
		{/if}
	</ScrollArea>
</section>
