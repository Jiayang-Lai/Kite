<script lang="ts">
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import FileCode2Icon from '@lucide/svelte/icons/file-code-2';
	import SearchIcon from '@lucide/svelte/icons/search';
	import TablePropertiesIcon from '@lucide/svelte/icons/table-properties';

	import DatabaseSchema from '$lib/components/cluster/database-schema.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

	type DatabaseManagementProps = {
		databases?: KustoDatabaseSchema;
		selectedDatabase?: string;
		selectedTable?: string;
		selectedFunction?: string;
		isLoading?: boolean;
		onopenquery?: () => void;
	};

	let {
		databases,
		selectedDatabase = $bindable(),
		selectedTable = $bindable(),
		selectedFunction = $bindable(),
		isLoading = false,
		onopenquery
	}: DatabaseManagementProps = $props();

	let databaseFilter = $state('');
	const databaseEntries = $derived(Object.values(databases ?? {}));
	const visibleDatabases = $derived(
		databaseEntries.filter((database) =>
			database.name.toLowerCase().includes(databaseFilter.trim().toLowerCase())
		)
	);
	const activeDatabase = $derived(
		selectedDatabase ? databases?.[selectedDatabase] : databaseEntries[0]
	);

	$effect(() => {
		const firstDatabase = databaseEntries[0];
		if (firstDatabase && !databases?.[selectedDatabase ?? '']) {
			selectedDatabase = firstDatabase.name;
			selectedTable = undefined;
			selectedFunction = undefined;
		}
	});

	function selectDatabase(databaseName: string) {
		if (databaseName === selectedDatabase) return;
		selectedDatabase = databaseName;
		selectedTable = undefined;
		selectedFunction = undefined;
	}
</script>

{#snippet schemaActions()}
	<Button size="xs" variant="outline" onclick={() => onopenquery?.()}>
		<FileCode2Icon />
		Open in Query
	</Button>
{/snippet}

<section class="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
	<Card.Root size="sm" class="h-52 shrink-0 lg:h-auto lg:w-72">
		<Card.Header>
			<Card.Title>Databases</Card.Title>
			<Card.Description>{databaseEntries.length} on the selected cluster</Card.Description>
		</Card.Header>
		<Card.Content class="min-h-0 flex flex-1 flex-col">
			<div class="relative shrink-0">
				<SearchIcon
					class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
				/>
				<Input
					bind:value={databaseFilter}
					class="h-8 pl-9 text-xs"
					placeholder="Filter databases"
				/>
			</div>
			<ScrollArea class="mt-2 min-h-0 flex-1" orientation="vertical" type="auto">
				<div class="space-y-1">
					{#each visibleDatabases as database (database.name)}
						<button
							type="button"
							class="hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2"
							class:bg-accent={database.name === activeDatabase?.name}
							onclick={() => selectDatabase(database.name)}
						>
							<DatabaseIcon class="text-muted-foreground size-4 shrink-0" />
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium">{database.name}</span>
								<span class="text-muted-foreground block text-xs">
									{database.tables.length}
									{database.tables.length === 1 ? 'table' : 'tables'}
								</span>
							</span>
						</button>
					{:else}
						<p class="text-muted-foreground px-2 py-3 text-xs">No databases found.</p>
					{/each}
				</div>
			</ScrollArea>
		</Card.Content>
	</Card.Root>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
		{#if activeDatabase}
			<DatabaseSchema
				class="min-h-0 flex-1"
				database={activeDatabase}
				bind:selectedTable
				bind:selectedFunction
				height="100%"
				headerActions={schemaActions}
			/>
		{:else if isLoading}
			<Card.Root class="min-h-0 flex-1">
				<Card.Header>
					<Card.Title>Loading cluster schema</Card.Title>
					<Card.Description>Retrieving the databases and tables for this cluster.</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-3">
					<Skeleton class="h-9 w-full" />
					<Skeleton class="h-36 w-full" />
				</Card.Content>
			</Card.Root>
		{:else}
			<Card.Root class="min-h-0 flex-1">
				<Card.Content
					class="text-muted-foreground grid h-full place-items-center text-center text-sm"
				>
					<div>
						<TablePropertiesIcon class="mx-auto mb-3 size-6" />
						<p class="font-medium text-foreground">No database schema available</p>
						<p class="mt-1">Connect to a cluster to browse its databases and tables.</p>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	</div>
</section>
