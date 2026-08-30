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
	const warningMessageClass =
		'border-warning/40 bg-warning/10 text-warning rounded-lg border p-3 text-sm';
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
		<p class={warningMessageClass}>
			Kite will switch to the Mock cluster and close all open query tabs after removal.
		</p>
	{:else}
		<p class={warningMessageClass}>
			Kite will not switch clusters after removal.
		</p>
	{/if}
	{#if removesStoredData}
		<p class={warningMessageClass}>
			This action cannot be undone. All DuckDB databases stored for this connection will be
			permanently deleted from this browser.
		</p>
	{/if}
	{#if removesEmulatedCluster}
		<p class={warningMessageClass}>
			This action cannot be undone. All in-memory DuckDB databases and ingested data for this
			cluster will be permanently released.
		</p>
	{/if}
</ConfirmationDialog>
