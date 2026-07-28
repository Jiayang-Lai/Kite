<script lang="ts">
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
	import LockIcon from '@lucide/svelte/icons/lock';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ServerIcon from '@lucide/svelte/icons/server';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';

	import AddClusterDialog from '$lib/components/cluster/add-cluster-dialog.svelte';
	import EmulatedStorageBadge from '$lib/components/cluster/emulated-storage-badge.svelte';
	import ManageClustersDialog from '$lib/components/cluster/manage-clusters-dialog.svelte';
	import RemoveClusterDialog from '$lib/components/cluster/remove-cluster-dialog.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { NewClusterConnection } from '$lib/cluster/cluster-connection-store.svelte';
	import type { KustoClusterConnection } from '$lib/kusto/query-client';

	const sidebar = Sidebar.useSidebar();

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
	let tooltipClusterId = $state<string>();
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

	function clusterTypeSummary(cluster?: KustoClusterConnection) {
		if (cluster?.kind === 'mock') return 'Mock schema';
		if (cluster?.kind === 'emulated') return 'Emulated cluster';
		return 'Remote Kusto';
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
						class="h-14"
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
						<div class="grid min-w-0 flex-1 gap-0.5 text-left text-sm leading-tight">
							<div class="flex min-w-0 items-center gap-1.5">
								<span
									class="min-w-0 flex-1 truncate font-semibold"
									title={selectedCluster?.name ?? selectedClusterId}
								>
									{selectedCluster?.name ?? selectedClusterId}
								</span>
								{#if selectedCluster?.kind === 'emulated'}
									<EmulatedStorageBadge
										storage={selectedCluster.emulatedStorage}
										class="h-4 px-1.5 text-[10px] [&>svg]:hidden"
									/>
								{/if}
							</div>
							<span
								class="text-muted-foreground truncate text-xs"
								title={selectedCluster?.description ?? clusterTypeSummary(selectedCluster)}
							>
								{selectedCluster?.description ?? clusterTypeSummary(selectedCluster)}
							</span>
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
				side={sidebar.isMobile ? 'bottom' : 'right'}
				align="start"
				sideOffset={4}
				class="bg-popover text-popover-foreground w-96 max-w-[calc(100vw-4rem)] rounded-md border p-1 shadow-md"
			>
				<DropdownMenu.Group>
					<DropdownMenu.GroupHeading class="text-muted-foreground px-2 py-1.5 text-xs font-medium">
						Clusters
					</DropdownMenu.GroupHeading>
					{#each clusters as cluster (cluster.id)}
						<Tooltip.Root open={tooltipClusterId === cluster.id}>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<DropdownMenu.Item
										{...props}
										class="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none"
										onpointerenter={() => (tooltipClusterId = cluster.id)}
										onpointerleave={() => (tooltipClusterId = undefined)}
										onfocus={() => (tooltipClusterId = cluster.id)}
										onblur={() => (tooltipClusterId = undefined)}
										onSelect={() => {
											tooltipClusterId = undefined;
											if (!disabled && !locked) onclusterchange?.(cluster.id);
										}}
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
												<span class="text-muted-foreground truncate text-xs">
													{cluster.description}
												</span>
											{/if}
										</div>
										<div class="flex shrink-0 items-center gap-1.5">
											{#if cluster.kind === 'emulated'}
												<EmulatedStorageBadge
													storage={cluster.emulatedStorage}
													class="h-4 px-1.5 text-[10px]"
												/>
											{/if}
											{#if cluster.id === selectedClusterId}
												<span class="text-muted-foreground text-xs">Current</span>
											{/if}
										</div>
									</DropdownMenu.Item>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content
								role="tooltip"
								side="right"
								align="start"
								sideOffset={8}
								class="max-w-sm"
							>
								<div class="grid gap-0.5">
									<span class="font-medium">{cluster.name}</span>
									{#if cluster.description}
										<span class="text-background/80">{cluster.description}</span>
									{/if}
								</div>
							</Tooltip.Content>
						</Tooltip.Root>
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
