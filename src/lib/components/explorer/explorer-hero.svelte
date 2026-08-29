<script lang="ts">
	import BookmarkIcon from '@lucide/svelte/icons/bookmark';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import FileCode2Icon from '@lucide/svelte/icons/file-code-2';
	import FunctionSquareIcon from '@lucide/svelte/icons/function-square';
	import SearchIcon from '@lucide/svelte/icons/search';
	import Table2Icon from '@lucide/svelte/icons/table-2';

	import EmulatedStorageBadge from '$lib/components/cluster/emulated-storage-badge.svelte';
	import type {
		ExplorerQuery,
		ExplorerSelection
	} from '$lib/components/query/database-explorer/cluster-explorer-types';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import type { EmulatedStorage } from '$lib/emulation/storage';
	import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

	type SchemaResult = ExplorerSelection & {
		kind: 'database' | 'table' | 'function';
		name: string;
	};

	type ExplorerHeroProps = {
		clusterName: string;
		databaseCount: number;
		tableCount: number;
		functionCount: number;
		databases: KustoDatabaseSchema;
		recentQueries: ExplorerQuery[];
		savedQueries: ExplorerQuery[];
		emulatedStorage?: EmulatedStorage;
		onqueryopen: (query: ExplorerQuery) => void;
		onselectionopen: (selection: ExplorerSelection) => void;
	};

	let {
		clusterName,
		databaseCount,
		tableCount,
		functionCount,
		databases,
		recentQueries,
		savedQueries,
		emulatedStorage,
		onqueryopen,
		onselectionopen
	}: ExplorerHeroProps = $props();
	let search = $state('');

	const schemaResults = $derived.by(() => {
		const term = search.trim().toLowerCase();
		if (!term) return [];

		const results: SchemaResult[] = [];
		for (const database of Object.values(databases)) {
			if (database.name.toLowerCase().includes(term)) {
				results.push({ kind: 'database', name: database.name, database: database.name });
			}
			for (const table of database.tables) {
				if (`${database.name} ${table.name}`.toLowerCase().includes(term)) {
					results.push({
						kind: 'table',
						name: table.name,
						database: database.name,
						table: table.name
					});
				}
			}
			for (const fn of database.functions ?? []) {
				if (`${database.name} ${fn.name}`.toLowerCase().includes(term)) {
					results.push({
						kind: 'function',
						name: fn.name,
						database: database.name,
						function: fn.name
					});
				}
			}
		}
		return results.slice(0, 8);
	});
</script>

<section class="min-h-0 flex-1 overflow-auto">
	<div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
		<header class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div class="min-w-0 max-w-3xl">
				<div class="flex flex-wrap items-center gap-2">
					<Badge variant="secondary">
						<SearchIcon />
						Data discovery
					</Badge>
					{#if emulatedStorage}
						<EmulatedStorageBadge storage={emulatedStorage} />
					{/if}
				</div>
				<h1 class="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
					Explore <span class="text-primary">{clusterName}</span>
				</h1>
				<p class="text-muted-foreground mt-2 max-w-2xl text-sm leading-6 sm:text-base">
					Find schema objects, return to recent work, or start a query with the current cluster
					context.
				</p>
			</div>
			<Button href="/explorer/query">
				<FileCode2Icon data-icon="inline-start" />
				New query
			</Button>
		</header>

		<Card.Root>
			<Card.Header>
				<Card.Title>Search the cluster schema</Card.Title>
				<Card.Description>Search databases, tables, and stored functions.</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="relative">
					<SearchIcon
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input bind:value={search} class="pl-9" placeholder="Search schema objects…" />
				</div>

				{#if search.trim()}
					<div class="mt-4 grid gap-2 md:grid-cols-2" aria-live="polite">
						{#each schemaResults as result (`${result.kind}:${result.database}:${result.name}`)}
							<Button
								variant="outline"
								class="h-auto min-w-0 justify-start py-3 text-left"
								onclick={() => onselectionopen(result)}
							>
								{#if result.kind === 'database'}
									<DatabaseIcon data-icon="inline-start" />
								{:else if result.kind === 'table'}
									<Table2Icon data-icon="inline-start" />
								{:else}
									<FunctionSquareIcon data-icon="inline-start" />
								{/if}
								<span class="min-w-0">
									<span class="block truncate">{result.name}</span>
									<span class="text-muted-foreground block truncate text-xs font-normal">
										{result.kind} in {result.database}
									</span>
								</span>
							</Button>
						{:else}
							<p class="text-muted-foreground py-4 text-sm">
								No schema objects match “{search.trim()}”.
							</p>
						{/each}
					</div>
				{/if}
			</Card.Content>
			<Card.Footer class="flex-wrap gap-2">
				<Badge variant="outline">{databaseCount} databases</Badge>
				<Badge variant="outline">{tableCount} tables</Badge>
				<Badge variant="outline">{functionCount} functions</Badge>
			</Card.Footer>
		</Card.Root>

		<div class="grid gap-4 lg:grid-cols-2">
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex items-center gap-2">
						<Clock3Icon class="size-4 text-muted-foreground" />
						Recent queries
					</Card.Title>
					<Card.Description>Continue where you left off on this cluster.</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-col gap-2">
					{#each recentQueries.slice(0, 4) as query (query.id ?? `${query.database}:${query.name}`)}
						<Button
							variant="ghost"
							class="h-auto min-w-0 justify-start py-2 text-left"
							onclick={() => onqueryopen(query)}
						>
							<FileCode2Icon data-icon="inline-start" />
							<span class="min-w-0">
								<span class="block truncate">{query.name}</span>
								<span class="text-muted-foreground block truncate text-xs font-normal">
									{query.database}
								</span>
							</span>
						</Button>
					{:else}
						<p class="text-muted-foreground text-sm">Run a query to build your recent history.</p>
					{/each}
				</Card.Content>
				<Card.Footer>
					<Button href="/explorer/query" variant="outline" size="sm">Open query workspace</Button>
				</Card.Footer>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title class="flex items-center gap-2">
						<BookmarkIcon class="size-4 text-muted-foreground" />
						Saved queries
					</Card.Title>
					<Card.Description>Your reusable KQL for the selected cluster.</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-col gap-2">
					{#each savedQueries.slice(0, 4) as query (query.id ?? `${query.database}:${query.name}`)}
						<Button
							variant="ghost"
							class="h-auto min-w-0 justify-start py-2 text-left"
							onclick={() => onqueryopen(query)}
						>
							<BookmarkIcon data-icon="inline-start" />
							<span class="min-w-0">
								<span class="block truncate">{query.name}</span>
								<span class="text-muted-foreground block truncate text-xs font-normal">
									{query.database}
								</span>
							</span>
						</Button>
					{:else}
						<p class="text-muted-foreground text-sm">Save useful KQL to return to it here.</p>
					{/each}
				</Card.Content>
				<Card.Footer>
					<Button href="/explorer/query/saved" variant="outline" size="sm">
						View all saved queries
					</Button>
				</Card.Footer>
			</Card.Root>
		</div>
	</div>
</section>
