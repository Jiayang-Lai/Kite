<script lang="ts">
	import ConfirmationDialog from '$lib/components/admin/confirmation-dialog.svelte';
	import type { KustoClusterConnection } from '$lib/kusto/query-client';

	type RemoveClusterDialogProps = {
		open?: boolean;
		cluster?: KustoClusterConnection;
		isCurrent?: boolean;
		onconfirm?: (clusterId: string) => Promise<void> | void;
	};

	let {
		open = $bindable(false),
		cluster,
		isCurrent = false,
		onconfirm
	}: RemoveClusterDialogProps = $props();
	const removesStoredData = $derived(
		cluster?.kind === 'emulated' && cluster.emulatedStorage?.mode === 'opfs'
	);
	const removesEmulatedCluster = $derived(cluster?.kind === 'emulated');
	const description = $derived(
		removesStoredData
			? 'This permanently removes the connection and all DuckDB databases stored for it in this browser.'
			: removesEmulatedCluster
				? 'This removes the connection and releases its in-memory DuckDB databases and ingested data.'
				: 'This removes the connection from this browser. It does not change or delete the Kusto cluster.'
	);
</script>

<ConfirmationDialog
	bind:open
	title={`Remove ${cluster?.name ?? 'cluster'}?`}
	{description}
	descriptionId="remove-cluster-description"
	actionLabel={removesEmulatedCluster ? 'Remove cluster' : 'Remove connection'}
	pendingLabel="Removing…"
	onsubmit={() => (cluster ? onconfirm?.(cluster.id) : undefined)}
>
	{#if isCurrent}
		<p class="text-muted-foreground rounded-lg border p-3 text-sm">
			Kite will switch to the Mock cluster after removal.
		</p>
	{/if}
</ConfirmationDialog>
