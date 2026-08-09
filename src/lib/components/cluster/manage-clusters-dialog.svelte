<script lang="ts">
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import AddClusterDialog from '$lib/components/cluster/add-cluster-dialog.svelte';
	import EmulatedStorageBadge from '$lib/components/cluster/emulated-storage-badge.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import type { NewClusterConnection } from '$lib/cluster/cluster-connection-store.svelte';
	import type { KustoClusterConnection } from '$lib/kusto/query-client';

	type ManageClustersDialogProps = {
		open?: boolean;
		clusters: KustoClusterConnection[];
		selectedClusterId: string;
		onedit?: (clusterId: string, draft: NewClusterConnection) => void;
		onremove?: (cluster: KustoClusterConnection) => void;
	};

	let {
		open = $bindable(false),
		clusters,
		selectedClusterId,
		onedit,
		onremove
	}: ManageClustersDialogProps = $props();
	let editingCluster = $state<KustoClusterConnection>();

	function saveEdit(draft: NewClusterConnection) {
		if (editingCluster) onedit?.(editingCluster.id, draft);
		editingCluster = undefined;
	}

	function selectAction(callback: (() => void) | undefined) {
		open = false;
		setTimeout(() => callback?.());
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class={editingCluster
			? 'grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden sm:max-w-xl'
			: 'gap-0 sm:max-w-xl'}
		aria-describedby="manage-clusters-description"
	>
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title>{editingCluster ? `Edit ${editingCluster.name}` : 'Manage clusters'}</Dialog.Title>
			<Dialog.Description id="manage-clusters-description">
				{editingCluster
					? 'Update this browser-local Kusto connection and its schema.'
					: 'Edit or remove connections saved in this browser.'}
			</Dialog.Description>
		</Dialog.Header>

		{#if editingCluster}
			<AddClusterDialog
				inline
				cluster={editingCluster}
				onsubmit={saveEdit}
				oncancel={() => (editingCluster = undefined)}
			/>
		{:else}
		<div class="max-h-[min(65dvh,32rem)] space-y-2 overflow-y-auto p-4">
				{#each clusters as cluster (cluster.id)}
					<div class="flex items-center gap-3 rounded-lg border p-3">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<p class="truncate text-sm font-medium" title={cluster.name}>{cluster.name}</p>
								{#if cluster.kind === 'emulated'}
									<EmulatedStorageBadge
										storage={cluster.emulatedStorage}
										class="h-4 px-1.5 text-[10px]"
									/>
								{/if}
								{#if cluster.id === selectedClusterId}
									<span class="text-muted-foreground shrink-0 text-xs">Current</span>
								{/if}
							</div>
							<p class="text-muted-foreground truncate text-xs" title={cluster.url}>
								{cluster.url}
							</p>
							{#if cluster.description}
								<p class="text-muted-foreground mt-1 line-clamp-2 text-xs">
									{cluster.description}
								</p>
							{/if}
						</div>

						<div class="flex shrink-0 items-center gap-1">
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Edit ${cluster.name}`}
								title={`Edit ${cluster.name}`}
								onclick={() => (editingCluster = cluster)}
							>
								<PencilIcon />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								class="text-destructive hover:text-destructive"
								aria-label={`Remove ${cluster.name}`}
								title={`Remove ${cluster.name}`}
								onclick={() => selectAction(() => onremove?.(cluster))}
							>
								<Trash2Icon />
							</Button>
						</div>
					</div>
				{:else}
					<p class="text-muted-foreground py-8 text-center text-sm">
						No browser-local clusters have been added.
					</p>
				{/each}
		</div>
		{/if}

		{#if !editingCluster}
			<Dialog.Footer class="border-t p-4">
				<Button variant="outline" onclick={() => (open = false)}>Done</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
