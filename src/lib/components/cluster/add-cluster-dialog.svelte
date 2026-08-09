<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { NewClusterConnection } from '$lib/cluster/cluster-connection-store.svelte';
	import { createStarterMockSchema, normalizeMockSchema } from '$lib/cluster/mock-cluster-schema';
	import type { EmulatedStorageMode } from '$lib/emulation/storage';
	import type { KustoClusterConnection } from '$lib/kusto/query-client';
	import { getAzureAuthenticationProfileStore } from '$lib/azure-auth/profile-store.svelte';

	const clusterKindOptions: Array<{ value: KustoClusterConnection['kind']; label: string }> = [
		{ value: 'remote', label: 'Remote' },
		{ value: 'log-analytics', label: 'Azure Log Analytics' },
		{ value: 'emulated', label: 'Emulated' },
		{ value: 'mock', label: 'Mock' }
	];

	type AddClusterDialogProps = {
		open?: boolean;
		cluster?: KustoClusterConnection;
		onsubmit?: (cluster: NewClusterConnection) => void;
		oncancel?: () => void;
		inline?: boolean;
	};

	let { open = $bindable(false), cluster, onsubmit, oncancel, inline = false }: AddClusterDialogProps = $props();
	let name = $state('');
	let kind = $state<KustoClusterConnection['kind']>('remote');
	let url = $state('');
	let workspaceId = $state('');
	let workspaceResourceId = $state('');
	let tenantId = $state('');
	let clientId = $state('');
	let authenticationProfileId = $state('');
	const azureAuthenticationProfiles = getAzureAuthenticationProfileStore();
	let defaultTimespan = $state('');
	let mockSchemaText = $state('');
	let description = $state('');
	let storageMode = $state<EmulatedStorageMode>('opfs');
	let error = $state('');
	let initializedTarget = '';
	const canSubmit = $derived(
		Boolean(name.trim()) &&
			(kind === 'remote'
				? Boolean(url.trim())
				: kind === 'log-analytics'
					? Boolean(
							azureAuthenticationProfiles.profiles.length &&
							authenticationProfileId &&
							workspaceId.trim() &&
							workspaceResourceId.trim() &&
							tenantId.trim() &&
							clientId.trim()
						)
					: kind === 'mock'
						? Boolean(mockSchemaText.trim())
						: true)
	);

	$effect(() => {
		if (!open && !inline) {
			initializedTarget = '';
			return;
		}

		const target = cluster?.id ?? 'new';
		if (target === initializedTarget) return;
		initializedTarget = target;
		name = cluster?.name ?? '';
		kind = cluster?.kind ?? 'remote';
		url = cluster?.kind === 'remote' ? cluster.url : '';
		workspaceId =
			cluster?.kind === 'log-analytics' ? (cluster.logAnalytics?.workspaceId ?? '') : '';
		workspaceResourceId =
			cluster?.kind === 'log-analytics' ? (cluster.logAnalytics?.workspaceResourceId ?? '') : '';
		tenantId = cluster?.kind === 'log-analytics' ? (cluster.logAnalytics?.tenantId ?? '') : '';
		clientId = cluster?.kind === 'log-analytics' ? (cluster.logAnalytics?.clientId ?? '') : '';
		authenticationProfileId =
			cluster?.kind === 'log-analytics' ? (cluster.logAnalytics?.authenticationProfileId ?? '') : '';
		defaultTimespan =
			cluster?.kind === 'log-analytics' ? (cluster.logAnalytics?.defaultTimespan ?? '') : '';
		mockSchemaText = JSON.stringify(
			cluster?.kind === 'mock'
				? (cluster.mockSchema ?? createStarterMockSchema())
				: createStarterMockSchema(),
			null,
			2
		);
		description = cluster?.description ?? '';
		storageMode =
			cluster?.kind === 'emulated' ? (cluster.emulatedStorage?.mode ?? 'memory') : 'opfs';
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
					: kind === 'emulated'
						? { name, kind, description, storageMode }
						: kind === 'log-analytics'
							? {
									name,
									kind,
									description,
									workspaceId,
									workspaceResourceId,
									tenantId,
									clientId,
								authenticationProfileId: authenticationProfileId || undefined,
									defaultTimespan
								}
							: { name, kind, url, description };
			onsubmit?.(draft);
			if (!inline) open = false;
		} catch (cause) {
			error =
				cause instanceof SyntaxError
					? 'Enter valid JSON for the mock schema.'
					: cause instanceof Error
						? cause.message
						: String(cause);
		}
	}

	function selectAzureAuthenticationProfile(value: string) {
		const profile = azureAuthenticationProfiles.profiles.find((item) => item.id === value);
		if (!profile) return;
		tenantId = profile.tenantId;
		clientId = profile.clientId;
	}

	const selectedAzureAuthenticationProfile = $derived(
		azureAuthenticationProfiles.profiles.find((profile) => profile.id === authenticationProfileId)
	);
	const azureAuthenticationProfileOptions = $derived(
		azureAuthenticationProfiles.profiles.map((profile) => ({ value: profile.id, label: profile.name }))
	);
</script>

{#snippet clusterForm()}
	<form class={inline ? 'flex min-h-0 flex-1 flex-col' : 'contents'} onsubmit={addCluster}>
			<div class="space-y-4 overflow-y-auto p-5">
				<div class="grid gap-1.5">
					<label class="text-sm font-medium" for="new-cluster-name">Name</label>
					<Input
						id="new-cluster-name"
						bind:value={name}
						placeholder="New Cluster"
						autocomplete="off"
						required
						maxlength={100}
					/>
				</div>

				<div class="grid gap-1.5">
					<label class="text-sm font-medium" for="new-cluster-kind">Kind</label>
					<Select.Root
						type="single"
						bind:value={kind}
						items={clusterKindOptions}
						disabled={Boolean(cluster)}
					>
						<Select.Trigger id="new-cluster-kind" class="w-full">
							<Select.Value />
						</Select.Trigger>
						<Select.Content>
							{#each clusterKindOptions as option (option.value)}
								<Select.Item {...option} />
							{/each}
						</Select.Content>
					</Select.Root>
					<p class="text-muted-foreground text-xs">
						{cluster
							? 'A saved connection cannot change backend kind.'
							: kind === 'mock'
								? "Use Kite's in-memory schema catalog for testing and development."
								: kind === 'emulated'
									? '(Memory Heavy) Translate KQL and execute it with an isolated DuckDB-Wasm backend in this browser.'
									: kind === 'log-analytics'
										? 'Query an Azure Log Analytics workspace with Microsoft Entra sign-in.'
										: 'Connect to a browser-accessible Kusto endpoint.'}
					</p>
				</div>

				{#if kind === 'remote'}
					<div class="grid gap-1.5">
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
				{:else if kind === 'log-analytics'}
					<div class="grid gap-4">
						{#if azureAuthenticationProfiles.profiles.length === 0}
							<p
								class="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 rounded-md border px-3 py-2 text-sm"
								role="alert"
							>
								No Azure authentication profiles are available. Create one from Settings → Azure
								authentication profiles before
								adding this connection.
							</p>
						{/if}
						<div class="grid gap-1.5">
							<label class="text-sm font-medium" for="log-analytics-profile">Azure authentication profile</label>
							<Select.Root
								type="single"
								bind:value={authenticationProfileId}
								items={azureAuthenticationProfileOptions}
								onValueChange={selectAzureAuthenticationProfile}
							>
								<Select.Trigger id="log-analytics-profile" class="w-full">
									<Select.Value placeholder="Select an authentication profile" />
								</Select.Trigger>
								<Select.Content>
									{#each azureAuthenticationProfileOptions as profile (profile.value)}
										<Select.Item {...profile} />
									{/each}
								</Select.Content>
							</Select.Root>
							{#if selectedAzureAuthenticationProfile}
								<p class="text-muted-foreground text-xs">
									{selectedAzureAuthenticationProfile.tenantId} · {selectedAzureAuthenticationProfile.clientId}
								</p>
							{/if}
						</div>
						<div class="grid gap-1.5">
							<label class="text-sm font-medium" for="log-analytics-workspace-id"
								>Workspace ID</label
							>
							<Input
								id="log-analytics-workspace-id"
								bind:value={workspaceId}
								placeholder="00000000-0000-0000-0000-000000000000"
								autocomplete="off"
								required
							/>
						</div>
						<div class="grid gap-1.5">
							<label class="text-sm font-medium" for="log-analytics-workspace-resource-id"
								>Workspace resource ID</label
							>
							<Input
								id="log-analytics-workspace-resource-id"
								bind:value={workspaceResourceId}
								placeholder="/subscriptions/.../resourceGroups/.../providers/Microsoft.OperationalInsights/workspaces/..."
								autocomplete="off"
								required
							/>
							<p class="text-muted-foreground text-xs">
								Find this value in the workspace’s Azure portal JSON view or Terraform output.
							</p>
						</div>
						<div class="grid gap-1.5">
							<label class="text-sm font-medium" for="log-analytics-timespan"
								>Default timespan <span class="text-muted-foreground font-normal">(optional)</span
								></label
							>
							<Input
								id="log-analytics-timespan"
								bind:value={defaultTimespan}
								placeholder="PT24H"
								autocomplete="off"
							/>
						</div>
					</div>
				{:else if kind === 'mock'}
					<div class="grid gap-1.5">
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
				{:else if kind === 'emulated'}
					<div class="grid gap-1.5">
						<label class="text-sm font-medium" for="new-cluster-storage">Data storage</label>
						<Select.Root type="single" bind:value={storageMode} disabled={Boolean(cluster)}>
							<Select.Trigger id="new-cluster-storage" class="w-full">
								<span data-slot="select-value" class="min-w-0 truncate">
									{storageMode === 'opfs' ? 'Persistent browser storage' : 'Ephemeral memory'}
								</span>
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="memory" label="Ephemeral memory" />
								<Select.Item value="opfs" label="Persistent browser storage" />
							</Select.Content>
						</Select.Root>
						<p class="text-muted-foreground text-xs">
							{storageMode === 'opfs'
								? `Stores DuckDB files in this site’s private browser storage so data survives cluster switches and reloads.${cluster ? ' Storage mode is fixed after creation.' : ''}`
								: `Keeps databases and ingested data in WASM memory. Switching clusters, leaving the workspace, or reloading clears it.${cluster ? ' Storage mode is fixed after creation.' : ''}`}
						</p>
					</div>
				{/if}

				<div class="grid gap-1.5">
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
				<Button
					type="button"
					variant="outline"
					onclick={() => {
						if (!inline) open = false;
						oncancel?.();
					}}
				>Cancel</Button>
				<Button type="submit" disabled={!canSubmit}
					>{cluster ? 'Save changes' : 'Add and connect'}</Button
				>
			</Dialog.Footer>
	</form>
{/snippet}

{#if inline}
	{@render clusterForm()}
{:else}
	<Dialog.Root bind:open>
		<Dialog.Content
			class="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden sm:max-w-xl"
			aria-describedby="add-cluster-dialog-description"
		>
			<Dialog.Header class="border-b p-5 pr-14">
				<Dialog.Title>{cluster ? 'Edit cluster' : 'Add cluster'}</Dialog.Title>
				<Dialog.Description id="add-cluster-dialog-description">
					{cluster
						? 'Update this browser-local Kusto connection and its schema.'
						: 'Save a browser-local Kusto connection and connect to it.'}
				</Dialog.Description>
			</Dialog.Header>
			{@render clusterForm()}
		</Dialog.Content>
	</Dialog.Root>
{/if}
