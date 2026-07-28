<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
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
	let error = $state('');
	let removing = $state(false);
	const removesStoredData = $derived(
		cluster?.kind === 'emulated' && cluster.emulatedStorage?.mode === 'opfs'
	);
	const removesEmulatedCluster = $derived(cluster?.kind === 'emulated');

	$effect(() => {
		if (!open) error = '';
	});

	async function removeCluster() {
		if (!cluster) return;
		error = '';
		removing = true;
		try {
			await onconfirm?.(cluster.id);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			removing = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="gap-0 sm:max-w-md" aria-describedby="remove-cluster-description">
		<Dialog.Header class="p-5 pr-14">
			<Dialog.Title>Remove {cluster?.name ?? 'cluster'}?</Dialog.Title>
			<Dialog.Description id="remove-cluster-description">
				{#if removesStoredData}
					This permanently removes the connection and all DuckDB databases stored for it in this
					browser.
				{:else if removesEmulatedCluster}
					This removes the connection and releases its in-memory DuckDB databases and ingested data.
				{:else}
					This removes the connection from this browser. It does not change or delete the Kusto
					cluster.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if isCurrent || error}
			<div class="space-y-3 px-5 pb-5">
				{#if isCurrent}
					<p class="text-muted-foreground rounded-lg border p-3 text-sm">
						Kite will switch to the Mock cluster after removal.
					</p>
				{/if}
				{#if error}
					<p class="text-destructive text-sm" role="alert">{error}</p>
				{/if}
			</div>
		{/if}

		<Dialog.Footer class="border-t p-4">
			<Button variant="outline" onclick={() => (open = false)} disabled={removing}>Cancel</Button>
			<Button variant="destructive" onclick={removeCluster} disabled={removing}>
				{removing ? 'Removing…' : removesEmulatedCluster ? 'Remove cluster' : 'Remove connection'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
