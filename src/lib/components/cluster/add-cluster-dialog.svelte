<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { NewClusterConnection } from '$lib/cluster/cluster-connection-store.svelte';
	import { createStarterMockSchema, normalizeMockSchema } from '$lib/cluster/mock-cluster-schema';
	import type { KustoClusterConnection } from '$lib/kusto/query-client';

	type AddClusterDialogProps = {
		open?: boolean;
		cluster?: KustoClusterConnection;
		onsubmit?: (cluster: NewClusterConnection) => void;
	};

	let { open = $bindable(false), cluster, onsubmit }: AddClusterDialogProps = $props();
	let name = $state('');
	let kind = $state<KustoClusterConnection['kind']>('remote');
	let url = $state('');
	let mockSchemaText = $state('');
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
		kind = cluster?.kind ?? 'remote';
		url = cluster?.kind === 'remote' ? cluster.url : '';
		mockSchemaText = JSON.stringify(
			cluster?.kind === 'mock'
				? (cluster.mockSchema ?? createStarterMockSchema())
				: createStarterMockSchema(),
			null,
			2
		);
		description = cluster?.description ?? '';
		error = '';
	});

	function addCluster(event: SubmitEvent) {
		event.preventDefault();
		error = '';

		try {
			const draft: NewClusterConnection =
				kind === 'mock'
					? {
							name,
							kind,
							description,
							mockSchema: normalizeMockSchema(JSON.parse(mockSchemaText) as unknown)
						}
					: { name, kind, url, description };
			onsubmit?.(draft);
			open = false;
		} catch (cause) {
			error =
				cause instanceof SyntaxError
					? 'Enter valid JSON for the mock schema.'
					: cause instanceof Error
						? cause.message
						: String(cause);
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="gap-0 sm:max-w-xl" aria-describedby="add-cluster-dialog-description">
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title>{cluster ? 'Edit cluster' : 'Add cluster'}</Dialog.Title>
			<Dialog.Description id="add-cluster-dialog-description">
				{cluster
					? 'Update this browser-local Kusto connection and its schema.'
					: 'Save a browser-local Kusto connection and connect to it.'}
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
					<label class="text-sm font-medium" for="new-cluster-kind">Kind</label>
					<Select.Root type="single" bind:value={kind}>
						<Select.Trigger id="new-cluster-kind" class="w-full">
							<Select.Value />
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="remote" label="Remote" />
							<Select.Item value="mock" label="Mock" />
						</Select.Content>
					</Select.Root>
					<p class="text-muted-foreground text-xs">
						{kind === 'mock'
							? 'Use Kite’s in-memory schema catalog for testing and development.'
							: 'Connect to a browser-accessible Kusto endpoint.'}
					</p>
				</div>

				{#if kind === 'remote'}
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
				{:else}
					<div class="space-y-1.5">
						<label class="text-sm font-medium" for="new-cluster-mock-schema">Schema JSON</label>
						<Textarea
							id="new-cluster-mock-schema"
							bind:value={mockSchemaText}
							class="min-h-56 font-mono text-xs"
							rows={12}
							required
							spellcheck={false}
							aria-describedby="new-cluster-mock-schema-help"
						/>
						<p id="new-cluster-mock-schema-help" class="text-muted-foreground text-xs">
							Define at least one database. Each database needs a matching name and a tables array.
						</p>
					</div>
				{/if}

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
