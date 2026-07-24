<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { NewClusterConnection } from '$lib/cluster/cluster-connection-store.svelte';
	import type { KustoClusterConnection } from '$lib/kusto/query-client';

	type AddClusterDialogProps = {
		open?: boolean;
		cluster?: KustoClusterConnection;
		onsubmit?: (cluster: NewClusterConnection) => void;
	};

	let { open = $bindable(false), cluster, onsubmit }: AddClusterDialogProps = $props();
	let name = $state('');
	let url = $state('');
	let description = $state('');
	let error = $state('');
	let initializedTarget = '';

	$effect(() => {
		if (!open) {
			initializedTarget = '';
			return;
		}

		const target = cluster?.id ?? 'new';
		if (target === initializedTarget) return;
		initializedTarget = target;
		name = cluster?.name ?? '';
		url = cluster?.url ?? '';
		description = cluster?.description ?? '';
		error = '';
	});

	function addCluster(event: SubmitEvent) {
		event.preventDefault();
		error = '';

		try {
			onsubmit?.({ name, url, description });
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="gap-0 sm:max-w-md" aria-describedby="add-cluster-dialog-description">
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title>{cluster ? 'Edit cluster' : 'Add cluster'}</Dialog.Title>
			<Dialog.Description id="add-cluster-dialog-description">
				{cluster
					? 'Update this browser-local Kusto connection.'
					: 'Save a Kusto endpoint in this browser and connect to it.'}
			</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={addCluster}>
			<div class="space-y-4 p-5">
				<div class="space-y-1.5">
					<label class="text-sm font-medium" for="new-cluster-name">Name</label>
					<Input
						id="new-cluster-name"
						bind:value={name}
						placeholder="Production analytics"
						autocomplete="off"
						required
						maxlength={100}
					/>
				</div>

				<div class="space-y-1.5">
					<label class="text-sm font-medium" for="new-cluster-url">Cluster URL</label>
					<Input
						id="new-cluster-url"
						bind:value={url}
						type="url"
						placeholder="https://example.kusto.windows.net"
						autocomplete="url"
						required
						aria-describedby="new-cluster-url-help"
					/>
					<p id="new-cluster-url-help" class="text-muted-foreground text-xs">
						Use the browser-accessible HTTP or HTTPS endpoint.
					</p>
				</div>

				<div class="space-y-1.5">
					<label class="text-sm font-medium" for="new-cluster-description">
						Description <span class="text-muted-foreground font-normal">(optional)</span>
					</label>
					<Textarea
						id="new-cluster-description"
						bind:value={description}
						placeholder="What this connection is used for"
						rows={3}
						maxlength={240}
					/>
				</div>

				{#if error}
					<p class="text-destructive text-sm" role="alert">{error}</p>
				{/if}
			</div>

			<Dialog.Footer class="border-t p-4">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit">{cluster ? 'Save changes' : 'Add and connect'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
