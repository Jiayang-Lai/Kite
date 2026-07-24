<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import type { KustoClusterConnection } from '$lib/kusto/query-client';

	type RemoveClusterDialogProps = {
		open?: boolean;
		cluster?: KustoClusterConnection;
		isCurrent?: boolean;
		onconfirm?: (clusterId: string) => void;
	};

	let {
		open = $bindable(false),
		cluster,
		isCurrent = false,
		onconfirm
	}: RemoveClusterDialogProps = $props();
	let error = $state('');

	$effect(() => {
		if (!open) error = '';
	});

	function removeCluster() {
		if (!cluster) return;
		error = '';
		try {
			onconfirm?.(cluster.id);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md" aria-describedby="remove-cluster-description">
		<Dialog.Header>
			<Dialog.Title>Remove {cluster?.name ?? 'cluster'}?</Dialog.Title>
			<Dialog.Description id="remove-cluster-description">
				This removes the connection from this browser. It does not change or delete the Kusto
				cluster.
			</Dialog.Description>
		</Dialog.Header>

		{#if isCurrent}
			<p class="text-muted-foreground rounded-lg border p-3 text-sm">
				Kite will switch to the Mock cluster after removal.
			</p>
		{/if}
		{#if error}
			<p class="text-destructive text-sm" role="alert">{error}</p>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="destructive" onclick={removeCluster}>Remove cluster</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
