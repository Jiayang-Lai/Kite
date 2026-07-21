<script lang="ts">
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
	import LockIcon from '@lucide/svelte/icons/lock';
	import ServerIcon from '@lucide/svelte/icons/server';

	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import type { KustoClusterConnection } from '$lib/kusto/query-client';

	type ClusterConnectionSelectorProps = {
		clusters: KustoClusterConnection[];
		selectedClusterId: string;
		disabled?: boolean;
		locked?: boolean;
		onclusterchange?: (clusterId: string) => void;
	};

	let {
		clusters,
		selectedClusterId,
		disabled = false,
		locked = false,
		onclusterchange
	}: ClusterConnectionSelectorProps = $props();

	const selectedCluster = $derived(clusters.find((cluster) => cluster.id === selectedClusterId));
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
							{#if selectedCluster?.description}
								<span class="truncate text-xs" title={selectedCluster.description}
									>{selectedCluster.description}</span
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
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Group>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>
