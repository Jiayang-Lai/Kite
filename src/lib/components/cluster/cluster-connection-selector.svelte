<script lang="ts">
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
	import LockIcon from '@lucide/svelte/icons/lock';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ServerIcon from '@lucide/svelte/icons/server';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';

	import AddClusterDialog from '$lib/components/cluster/add-cluster-dialog.svelte';
	import ManageClustersDialog from '$lib/components/cluster/manage-clusters-dialog.svelte';
	import RemoveClusterDialog from '$lib/components/cluster/remove-cluster-dialog.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import type { NewClusterConnection } from '$lib/cluster/cluster-connection-store.svelte';
	import type { KustoClusterConnection } from '$lib/kusto/query-client';

	type ClusterConnectionSelectorProps = {
		clusters: KustoClusterConnection[];
		customClusters?: KustoClusterConnection[];
		selectedClusterId: string;
		disabled?: boolean;
		locked?: boolean;
		onclusterchange?: (clusterId: string) => void;
		onclusteradd?: (cluster: NewClusterConnection) => void;
		onclusteredit?: (clusterId: string, cluster: NewClusterConnection) => void;
		onclusterremove?: (clusterId: string) => Promise<void> | void;
	};

	let {
		clusters,
		customClusters = [],
		selectedClusterId,
		disabled = false,
		locked = false,
		onclusterchange,
		onclusteradd,
		onclusteredit,
		onclusterremove
	}: ClusterConnectionSelectorProps = $props();

	let connectionDialogOpen = $state(false);
	let manageClustersOpen = $state(false);
	let removeClusterOpen = $state(false);
	let editingCluster = $state<KustoClusterConnection>();
	let removingCluster = $state<KustoClusterConnection>();
	const selectedCluster = $derived(clusters.find((cluster) => cluster.id === selectedClusterId));

	function openAddCluster() {
		editingCluster = undefined;
		connectionDialogOpen = true;
	}

	function openEditCluster(cluster: KustoClusterConnection) {
		editingCluster = cluster;
		connectionDialogOpen = true;
	}

	function openRemoveCluster(cluster: KustoClusterConnection) {
		removingCluster = cluster;
		removeClusterOpen = true;
	}

	function saveCluster(draft: NewClusterConnection) {
		if (editingCluster) {
			onclusteredit?.(editingCluster.id, draft);
		} else {
			onclusteradd?.(draft);
		}
	}
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						{...props}
						size="lg"
						tooltipContent={locked ? 'Cluster selection is locked' : 'Switch cluster'}
						disabled={disabled || locked}
						aria-disabled={disabled || locked}
					>
						<div
							class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg"
						>
							{#if selectedCluster?.kind === 'mock'}
								<FlaskConicalIcon class="size-4" />
							{:else if selectedCluster?.kind === 'emulated'}
								<CpuIcon class="size-4" />
							{:else}
								<ServerIcon class="size-4" />
							{/if}
						</div>
						<div class="grid min-w-0 flex-1 text-left text-sm leading-tight">
							<span
								class="truncate font-semibold"
								title={selectedCluster?.name ?? selectedClusterId}
								>{selectedCluster?.name ?? selectedClusterId}</span
							>
							{#if selectedCluster?.description || selectedCluster?.emulatedStorage?.mode === 'opfs'}
								<span
									class="truncate text-xs"
									title={selectedCluster.description ?? 'Persistent browser data'}
									>{selectedCluster.description ?? 'Persistent browser data'}</span
								>
							{/if}
						</div>
						{#if locked}
							<LockIcon
								class="text-muted-foreground ms-auto size-4"
								aria-label="Cluster selection locked"
							/>
						{:else}
							<ChevronsUpDownIcon class="ms-auto" />
						{/if}
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>

			<DropdownMenu.Content
				side="right"
				align="start"
				sideOffset={4}
				class="bg-popover text-popover-foreground min-w-56 rounded-md border p-1 shadow-md"
			>
				<DropdownMenu.Group>
					<DropdownMenu.GroupHeading class="text-muted-foreground px-2 py-1.5 text-xs font-medium">
						Clusters
					</DropdownMenu.GroupHeading>
					{#each clusters as cluster (cluster.id)}
						<DropdownMenu.Item
							class="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none"
							onSelect={() => !disabled && !locked && onclusterchange?.(cluster.id)}
						>
							{#if cluster.kind === 'mock'}
								<FlaskConicalIcon class="size-4" />
							{:else if cluster.kind === 'emulated'}
								<CpuIcon class="size-4" />
							{:else}
								<ServerIcon class="size-4" />
							{/if}
							<div class="grid min-w-0 flex-1 gap-0.5">
								<span class="truncate">{cluster.name}</span>
								{#if cluster.description}
									<span class="text-muted-foreground truncate text-xs">{cluster.description}</span>
								{/if}
							</div>
							{#if cluster.id === selectedClusterId}
								<span class="text-muted-foreground text-xs">Current</span>
							{:else if cluster.emulatedStorage?.mode === 'opfs'}
								<span class="text-muted-foreground text-xs">Persistent</span>
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Group>
				<DropdownMenu.Separator />
				<DropdownMenu.Item
					class="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm font-medium outline-none"
					onSelect={openAddCluster}
				>
					<PlusIcon class="size-4" />
					Add cluster
				</DropdownMenu.Item>
				<DropdownMenu.Item
					class="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm font-medium outline-none"
					disabled={customClusters.length === 0}
					onSelect={() => (manageClustersOpen = true)}
				>
					<Settings2Icon class="size-4" />
					Manage clusters
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>

<AddClusterDialog
	bind:open={connectionDialogOpen}
	cluster={editingCluster}
	onsubmit={saveCluster}
/>
<ManageClustersDialog
	bind:open={manageClustersOpen}
	clusters={customClusters}
	{selectedClusterId}
	onedit={openEditCluster}
	onremove={openRemoveCluster}
/>
<RemoveClusterDialog
	bind:open={removeClusterOpen}
	cluster={removingCluster}
	isCurrent={removingCluster?.id === selectedClusterId}
	onconfirm={onclusterremove}
/>
