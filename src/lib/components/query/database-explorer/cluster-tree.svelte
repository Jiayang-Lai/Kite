<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import DatabaseSearchIcon from '@lucide/svelte/icons/database-search';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SquareFunctionIcon from '@lucide/svelte/icons/square-function';
	import TablePropertiesIcon from '@lucide/svelte/icons/table-properties';
	import { Collapsible, Popover } from 'bits-ui';

	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import type { ClusterTreeProps } from './cluster-explorer-types';
	import VirtualizedSchemaObjectList from './virtualized-schema-object-list.svelte';
	import { cn } from '$lib/utils';

	let {
		databases,
		selectedDatabase = $bindable(),
		selectedTable = $bindable(),
		selectedFunction = $bindable(),
		filter = $bindable(''),
		expansionState,
		onexpansionchange,
		onselect
	}: ClusterTreeProps = $props();

	const sidebar = Sidebar.useSidebar();
	let databasesOpen = $state(true);
	let dropdownOpen = $state(false);
	const normalizedFilter = $derived(filter.trim().toLowerCase());
	const isCollapsedDesktop = $derived(sidebar.state === 'collapsed' && !sidebar.isMobile);
	const filteredDatabases = $derived.by(() =>
		Object.keys(databases).filter(
			(name) =>
				name.toLowerCase().includes(normalizedFilter) ||
				databases[name].tables.some((table) =>
					table.name.toLowerCase().includes(normalizedFilter)
				) ||
				(databases[name].functions ?? []).some((fn) =>
					fn.name.toLowerCase().includes(normalizedFilter)
				)
		)
	);

	function isDatabaseExpanded(databaseName: string) {
		return Boolean(normalizedFilter) || Boolean(expansionState.databases[databaseName]);
	}

	function setDatabaseExpanded(databaseName: string, open: boolean) {
		onexpansionchange({ type: 'database', database: databaseName, open });
	}

	function isGroupExpanded(databaseName: string, group: 'tables' | 'functions') {
		return Boolean(normalizedFilter) || Boolean(expansionState.groups[`${databaseName}:${group}`]);
	}

	function setGroupExpanded(databaseName: string, group: 'tables' | 'functions', open: boolean) {
		onexpansionchange({ type: 'group', database: databaseName, group, open });
	}

	function getVisibleTables(databaseName: string) {
		const tables = databases[databaseName].tables;
		return !normalizedFilter || databaseName.toLowerCase().includes(normalizedFilter)
			? tables
			: tables.filter((table) => table.name.toLowerCase().includes(normalizedFilter));
	}

	function getVisibleFunctions(databaseName: string) {
		const functions = databases[databaseName].functions ?? [];
		return !normalizedFilter || databaseName.toLowerCase().includes(normalizedFilter)
			? functions
			: functions.filter((fn) => fn.name.toLowerCase().includes(normalizedFilter));
	}

	function selectDatabase(databaseName: string) {
		if (selectedDatabase !== databaseName) {
			selectedDatabase = databaseName;
			selectedTable = undefined;
			selectedFunction = undefined;
		}
		onselect?.({ database: databaseName });
	}

	function selectTable(databaseName: string, tableName: string) {
		dropdownOpen = false;
		if (onselect) {
			selectedDatabase = databaseName;
			selectedTable = tableName;
			selectedFunction = undefined;
			setDatabaseExpanded(databaseName, true);
			onselect({ database: databaseName, table: tableName });
			return;
		}

		if (selectedDatabase === databaseName && selectedTable === tableName) {
			selectedTable = undefined;
			return;
		}

		selectedDatabase = databaseName;
		selectedTable = tableName;
		selectedFunction = undefined;
		setDatabaseExpanded(databaseName, true);
	}

	function selectFunction(databaseName: string, functionName: string) {
		dropdownOpen = false;
		if (onselect) {
			selectedDatabase = databaseName;
			selectedTable = undefined;
			selectedFunction = functionName;
			setDatabaseExpanded(databaseName, true);
			onselect({ database: databaseName, function: functionName });
			return;
		}

		if (selectedDatabase === databaseName && selectedFunction === functionName) {
			selectedFunction = undefined;
			return;
		}

		selectedDatabase = databaseName;
		selectedTable = undefined;
		selectedFunction = functionName;
		setDatabaseExpanded(databaseName, true);
	}

</script>

{#snippet databaseTree()}
	<Sidebar.MenuSub
		class={isCollapsedDesktop
			? 'mx-0 translate-x-0 border-l-0 px-0'
			: 'mx-1.5 translate-x-0 px-1'}
	>
		{#each filteredDatabases as databaseName (databaseName)}
			{@const expanded = isDatabaseExpanded(databaseName)}
			<Collapsible.Root
				class="group/database"
				open={expanded}
				onOpenChange={(open) => setDatabaseExpanded(databaseName, open)}
			>
				<Sidebar.MenuSubItem>
					<button
						type="button"
						class={cn(
							'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 pr-8 text-left text-sm outline-none focus-visible:ring-2',
							selectedDatabase === databaseName &&
								'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
						)}
						onclick={() => selectDatabase(databaseName)}
						title={databaseName}
					>
						<DatabaseIcon class="size-4 shrink-0" />
						<span class="min-w-0 flex-1 truncate" title={databaseName}>{databaseName}</span>
					</button>
					<Collapsible.Trigger>
						{#snippet child({ props })}
							<Sidebar.MenuAction
								{...props}
								aria-label={`${expanded ? 'Collapse' : 'Expand'} ${databaseName}`}
							>
								<ChevronRightIcon
									class="size-3.5 shrink-0 transition-transform group-data-[state=open]/database:rotate-90"
								/>
							</Sidebar.MenuAction>
						{/snippet}
					</Collapsible.Trigger>
				</Sidebar.MenuSubItem>

				<Collapsible.Content>
					<div class="border-sidebar-border ms-1.5 mt-0.5 border-s ps-1.5">
						<Collapsible.Root
							class="group/object-group"
							open={isGroupExpanded(databaseName, 'tables')}
							onOpenChange={(open) => setGroupExpanded(databaseName, 'tables', open)}
						>
							<Collapsible.Trigger
								type="button"
								class="hover:bg-sidebar-accent/50 focus-visible:ring-sidebar-ring flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-semibold tracking-wide uppercase outline-none focus-visible:ring-2"
							>
								<ChevronRightIcon
									class="text-muted-foreground size-3.5 transition-transform group-data-[state=open]/object-group:rotate-90"
								/>
								<TablePropertiesIcon class="text-muted-foreground size-3.5" />
								<span class="min-w-0 flex-1 truncate">Tables</span>
								<span class="text-muted-foreground font-normal normal-case"
									>{databases[databaseName].tables.length}</span
								>
							</Collapsible.Trigger>
							<Collapsible.Content>
							{@const visibleTables = getVisibleTables(databaseName)}
								<VirtualizedSchemaObjectList
									items={visibleTables}
									kind="table"
									selectedName={selectedDatabase === databaseName ? selectedTable : undefined}
									onselect={(tableName) => selectTable(databaseName, tableName)}
								/>
							</Collapsible.Content>
						</Collapsible.Root>

						<Collapsible.Root
							class="group/object-group"
							open={isGroupExpanded(databaseName, 'functions')}
							onOpenChange={(open) => setGroupExpanded(databaseName, 'functions', open)}
						>
							<Collapsible.Trigger
								type="button"
								class="hover:bg-sidebar-accent/50 focus-visible:ring-sidebar-ring mt-0.5 flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-semibold tracking-wide uppercase outline-none focus-visible:ring-2"
							>
								<ChevronRightIcon
									class="text-muted-foreground size-3.5 transition-transform group-data-[state=open]/object-group:rotate-90"
								/>
								<SquareFunctionIcon class="text-muted-foreground size-3.5" />
								<span class="min-w-0 flex-1 truncate">Functions</span>
								<span class="text-muted-foreground font-normal normal-case"
									>{databases[databaseName].functions?.length ?? 0}</span
								>
							</Collapsible.Trigger>
							<Collapsible.Content>
								{@const visibleFunctions = getVisibleFunctions(databaseName)}
								<VirtualizedSchemaObjectList
									items={visibleFunctions}
									kind="function"
									selectedName={selectedDatabase === databaseName ? selectedFunction : undefined}
									onselect={(functionName) => selectFunction(databaseName, functionName)}
								/>
							</Collapsible.Content>
						</Collapsible.Root>
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		{:else}
			<p class="text-muted-foreground px-2 py-3 text-xs">No databases found.</p>
		{/each}
	</Sidebar.MenuSub>
{/snippet}

{#if isCollapsedDesktop}
	<Popover.Root bind:open={dropdownOpen}>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Popover.Trigger openOnHover openDelay={0} closeDelay={150}>
					{#snippet child({ props })}
						<Sidebar.MenuButton
							{...props}
							isActive={dropdownOpen}
							aria-label="Browse databases"
						>
							{#snippet child({ props })}
								<a {...props} href="/explorer/query" onclick={(event) => event.stopPropagation()}>
									<DatabaseSearchIcon />
									<span>Databases</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					{/snippet}
				</Popover.Trigger>

				<Popover.Portal>
					<Popover.Content
						side="right"
						align="start"
						sideOffset={8}
						class="z-50 w-80 rounded-md border bg-popover p-0 text-popover-foreground shadow-md"
					>
						<div class="flex h-[min(32rem,calc(100vh-1rem))] flex-col">
							<div class="shrink-0 border-b px-2 py-2">
								<p class="px-2 text-xs font-medium">Databases</p>
								<div class="relative mt-2">
									<SearchIcon
										class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
									/>
									<Input
										bind:value={filter}
										class="h-8 bg-background pr-2 pl-8 text-xs"
										placeholder="Search cluster"
									/>
								</div>
							</div>
							<ScrollArea class="min-h-0 flex-1" orientation="vertical">
								<div class="p-2">
									{@render databaseTree()}
								</div>
							</ScrollArea>
						</div>
					</Popover.Content>
				</Popover.Portal>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Popover.Root>
{:else}
	<Collapsible.Root
		class="group/collapsible"
		open={databasesOpen || Boolean(normalizedFilter)}
		onOpenChange={(open) => (databasesOpen = open)}
	>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Collapsible.Trigger>
					{#snippet child({ props })}
						<Sidebar.MenuButton {...props} tooltipContent="Databases">
							<DatabaseSearchIcon />
							<span>Databases</span>
							<ChevronRightIcon
								class="ms-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
							/>
						</Sidebar.MenuButton>
					{/snippet}
				</Collapsible.Trigger>
			</Sidebar.MenuItem>
		</Sidebar.Menu>

		<Collapsible.Content class="group-data-[collapsible=icon]:hidden">
			{@render databaseTree()}
		</Collapsible.Content>
	</Collapsible.Root>
{/if}
