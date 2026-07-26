<script lang="ts">
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import { page } from '$app/state';
	import AdministrationNavigation from '$lib/components/app/administration-navigation.svelte';
	import type {
		ExplorerExpansionChange,
		ExplorerExpansionState
	} from '$lib/cluster/cluster-session.svelte';
	import ClusterTree from '$lib/components/query/database-explorer/cluster-tree.svelte';
	import ExplorerSearch from '$lib/components/query/database-explorer/explorer-search.svelte';
	import RecentQueriesNav from '$lib/components/query/database-explorer/recent-queries-nav.svelte';
	import SavedQueriesNav from '$lib/components/query/database-explorer/saved-queries-nav.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
	import { cn } from '$lib/utils';
	import type { ExplorerQuery } from './database-explorer/cluster-explorer-types';
	import type { ExplorerSelection } from './database-explorer/cluster-explorer-types';

	type DatabaseExplorerProps = {
		databases?: KustoDatabaseSchema;
		connectionStatus?: 'loading' | 'ready' | 'error';
		showCluster?: boolean;
		clusterDisabled?: boolean;
		selectedDatabase: string;
		selectedTable?: string;
		selectedFunction?: string;
		expansionState: ExplorerExpansionState;
		onexpansionchange: (change: ExplorerExpansionChange) => void;
		recentQueries?: ExplorerQuery[];
		savedQueries?: ExplorerQuery[];
		onqueryselect?: (query: ExplorerQuery) => void;
		onrecentquerydelete?: (query: ExplorerQuery) => void;
		onsavedquerydelete?: (query: ExplorerQuery) => void;
		onselectionchange?: (selection: ExplorerSelection) => void;
		filter?: string;
		class?: string;
	};

	let {
		databases = {},
		connectionStatus = 'ready',
		showCluster = connectionStatus === 'ready',
		clusterDisabled = false,
		selectedDatabase = $bindable(),
		selectedTable = $bindable(),
		selectedFunction = $bindable(),
		expansionState,
		onexpansionchange,
		recentQueries = [],
		savedQueries = [],
		onqueryselect,
		onrecentquerydelete,
		onsavedquerydelete,
		onselectionchange,
		filter = $bindable(''),
		class: className = ''
	}: DatabaseExplorerProps = $props();

	function selectRecentQuery(query: ExplorerQuery) {
		selectedTable = undefined;
		selectedFunction = undefined;
		onqueryselect?.(query);
	}

	const isExplorerOverview = $derived(page.url.pathname === '/explorer');
</script>

<Sidebar.Content
	class={cn('min-w-0', clusterDisabled && 'pointer-events-none opacity-60', className)}
	aria-label="Cluster explorer"
	aria-busy={connectionStatus === 'loading'}
>
	{#if showCluster}
		<Sidebar.Group class="pt-1">
			<Sidebar.GroupLabel>Explorer</Sidebar.GroupLabel>
			<ExplorerSearch bind:value={filter} disabled={clusterDisabled} />
			<Sidebar.Menu class="mt-1">
				<Sidebar.MenuItem>
					<Sidebar.MenuButton isActive={isExplorerOverview} tooltipContent="Explorer overview">
						{#snippet child({ props })}
							<a {...props} href="/explorer">
								<LayoutDashboardIcon />
								<span>Overview</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
			<div class="mt-1">
				<ClusterTree
					{databases}
					bind:selectedDatabase
					bind:selectedTable
					bind:selectedFunction
					bind:filter
					{expansionState}
					{onexpansionchange}
					onselect={onselectionchange}
				/>
			</div>
			<SavedQueriesNav
				queries={savedQueries}
				{filter}
				open={Boolean(filter.trim()) || expansionState.sections['saved-queries']}
				onopenchange={(open) =>
					onexpansionchange({ type: 'section', section: 'saved-queries', open })}
				onselect={selectRecentQuery}
				delete={onsavedquerydelete}
			/>
			<RecentQueriesNav
				queries={recentQueries}
				{filter}
				open={Boolean(filter.trim()) || expansionState.sections['recent-queries']}
				onopenchange={(open) =>
					onexpansionchange({ type: 'section', section: 'recent-queries', open })}
				onselect={selectRecentQuery}
				delete={onrecentquerydelete}
			/>
		</Sidebar.Group>
	{/if}
	<AdministrationNavigation />
</Sidebar.Content>
