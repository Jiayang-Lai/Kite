<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import BookmarkIcon from '@lucide/svelte/icons/bookmark';
	import FileCode2Icon from '@lucide/svelte/icons/file-code-2';
	import SearchIcon from '@lucide/svelte/icons/search';

	import EmulatedStorageBadge from '$lib/components/cluster/emulated-storage-badge.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import type { EmulatedStorage } from '$lib/emulation/storage';

	type ExplorerHeroProps = {
		clusterName: string;
		databaseCount: number;
		tableCount: number;
		emulatedStorage?: EmulatedStorage;
	};

	let { clusterName, databaseCount, tableCount, emulatedStorage }: ExplorerHeroProps = $props();
</script>

<section class="min-h-0 flex-1 overflow-auto">
	<div class="mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center py-8 sm:py-12">
		<div class="max-w-2xl">
			<Badge variant="secondary">
				<SearchIcon />
				Cluster explorer
			</Badge>
			<h1 class="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
				Explore <span class="text-primary">{clusterName}</span> and turn data into answers.
			</h1>
			<p class="text-muted-foreground mt-3 text-base leading-7">
				Browse connected cluster schema, compose KQL queries, and return to the queries you saved
				for later.
			</p>
			<div class="text-muted-foreground mt-5 flex flex-wrap items-center gap-2 text-sm">
				<Badge variant="outline"
					>{databaseCount} {databaseCount === 1 ? 'database' : 'databases'}</Badge
				>
				<Badge variant="outline">{tableCount} {tableCount === 1 ? 'table' : 'tables'}</Badge>
				{#if emulatedStorage}
					<EmulatedStorageBadge storage={emulatedStorage} />
				{/if}
			</div>
		</div>

		<div class="mt-8 grid gap-3 sm:grid-cols-2">
			<a href="/explorer/query" class="group min-w-0">
				<Card.Root class="h-full transition-colors group-hover:bg-accent/50">
					<Card.Header class="grid-cols-[auto_1fr_auto] gap-x-3">
						<FileCode2Icon class="row-span-2 mt-0.5 size-5 text-primary" />
						<Card.Title>Query workspace</Card.Title>
						<ArrowRightIcon class="row-span-2 mt-0.5 size-4 text-muted-foreground" />
						<Card.Description>Write, run, and inspect KQL queries.</Card.Description>
					</Card.Header>
				</Card.Root>
			</a>

			<a href="/explorer/query/saved" class="group min-w-0">
				<Card.Root class="h-full transition-colors group-hover:bg-accent/50">
					<Card.Header class="grid-cols-[auto_1fr_auto] gap-x-3">
						<BookmarkIcon class="row-span-2 mt-0.5 size-5 text-muted-foreground" />
						<Card.Title>Saved queries</Card.Title>
						<ArrowRightIcon class="row-span-2 mt-0.5 size-4 text-muted-foreground" />
						<Card.Description>Open and manage your locally saved KQL queries.</Card.Description>
					</Card.Header>
				</Card.Root>
			</a>
		</div>
	</div>
</section>
