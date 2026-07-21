<script lang="ts">
	import BookmarkIcon from '@lucide/svelte/icons/bookmark';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import FileCode2Icon from '@lucide/svelte/icons/file-code-2';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { Collapsible } from 'bits-ui';

	import SidebarRowOverflowMenu from '$lib/components/shared/sidebar-row-overflow-menu.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import type { ExplorerQuery } from './cluster-explorer-types';

	const MAX_VISIBLE_SAVED_QUERIES = 3;

	type SavedQueriesNavProps = {
		queries?: ExplorerQuery[];
		filter?: string;
		onselect?: (query: ExplorerQuery) => void;
		delete?: (query: ExplorerQuery) => void;
	};

	let { queries = [], filter = '', onselect, delete: ondelete }: SavedQueriesNavProps = $props();
	const sidebar = Sidebar.useSidebar();
	let open = $state(true);
	const isCollapsedDesktop = $derived(sidebar.state === 'collapsed' && !sidebar.isMobile);
	const filteredQueries = $derived(
		queries.filter((query) =>
			`${query.name} ${query.database}`.toLowerCase().includes(filter.trim().toLowerCase())
		)
	);
	const visibleQueries = $derived(filteredQueries.slice(0, MAX_VISIBLE_SAVED_QUERIES));
	const hasMoreQueries = $derived(filteredQueries.length > MAX_VISIBLE_SAVED_QUERIES);

	function getQueryPreview(query: ExplorerQuery) {
		return query.query.replace(/\s+/g, ' ').trim() || query.name;
	}
</script>

<Collapsible.Root bind:open class="group/collapsible">
	<Sidebar.Menu>
		<Sidebar.MenuItem>
			{#if isCollapsedDesktop}
				<Sidebar.MenuButton tooltipContent="Saved queries">
					{#snippet child({ props })}
						<a {...props} href="/explorer/query/saved">
							<BookmarkIcon />
							<span>Saved queries</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			{:else}
				<Collapsible.Trigger>
					{#snippet child({ props })}
						<Sidebar.MenuButton {...props} tooltipContent="Saved queries">
							<BookmarkIcon />
							<span>Saved queries</span>
							<ChevronRightIcon
								class="ms-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
							/>
						</Sidebar.MenuButton>
					{/snippet}
				</Collapsible.Trigger>
			{/if}
		</Sidebar.MenuItem>
	</Sidebar.Menu>

	<Collapsible.Content class="group-data-[collapsible=icon]:hidden">
		<Sidebar.MenuSub>
			{#each visibleQueries as query (query.id ?? `${query.database}:${query.name}`)}
				<Sidebar.MenuSubItem>
					<button
						type="button"
						class={`text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring flex h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-2 ${query.id ? 'pr-8' : ''}`}
						onclick={() => onselect?.(query)}
					>
						<FileCode2Icon class="text-muted-foreground size-4 shrink-0" />
						<span class="min-w-0">
							<span class="block truncate text-xs" title={query.name}>{getQueryPreview(query)}</span
							>
							<span class="text-muted-foreground block truncate text-[10px]">{query.database}</span>
						</span>
					</button>
					{#if query.id}
						<SidebarRowOverflowMenu
							label={query.name}
							header="Actions"
							actions={[
								{
									id: 'delete',
									label: 'Delete',
									icon: Trash2Icon,
									variant: 'destructive',
									onSelect: () => ondelete?.(query)
								}
							]}
						/>
					{/if}
				</Sidebar.MenuSubItem>
			{:else}
				<p class="text-muted-foreground px-2 py-3 text-xs">No saved queries found.</p>
			{/each}
			{#if hasMoreQueries}
				<Sidebar.MenuSubItem>
					<Sidebar.MenuSubButton href="/explorer/query/saved">
						<EllipsisIcon />
						<span>More</span>
					</Sidebar.MenuSubButton>
				</Sidebar.MenuSubItem>
			{/if}
		</Sidebar.MenuSub>
	</Collapsible.Content>
</Collapsible.Root>
