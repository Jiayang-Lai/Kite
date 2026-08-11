<script lang="ts">
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CloudCogIcon from '@lucide/svelte/icons/cloud-cog';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
	import LockIcon from '@lucide/svelte/icons/lock';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ServerIcon from '@lucide/svelte/icons/server';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import { onMount } from 'svelte';

	import AddClusterDialog from '$lib/components/cluster/add-cluster-dialog.svelte';
	import EmulatedStorageBadge from '$lib/components/cluster/emulated-storage-badge.svelte';
	import { getAzureAuthenticationProfileStore } from '$lib/azure-auth/profile-store.svelte';
	import ManageClustersDialog from '$lib/components/cluster/manage-clusters-dialog.svelte';
	import RemoveClusterDialog from '$lib/components/cluster/remove-cluster-dialog.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { NewClusterConnection } from '$lib/cluster/cluster-connection-store.svelte';
	import type { KustoClusterConnection } from '$lib/kusto/query-client';

	const sidebar = Sidebar.useSidebar();
	const azureAuthenticationProfiles = getAzureAuthenticationProfileStore();

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
		onlinkauthenticationprofile?: (clusterId: string, authenticationProfileId: string) => void;
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
		onclusterremove,
		onlinkauthenticationprofile
	}: ClusterConnectionSelectorProps = $props();

	let connectionDialogOpen = $state(false);
	let manageClustersOpen = $state(false);
	let removeClusterOpen = $state(false);
	let editingCluster = $state<KustoClusterConnection>();
	let removingCluster = $state<KustoClusterConnection>();
	let tooltipClusterId = $state<string>();
	let linkProfileOpen = $state(false);
	let linkingCluster = $state<KustoClusterConnection>();
	let linkProfileId = $state('');
	const selectedCluster = $derived(clusters.find((cluster) => cluster.id === selectedClusterId));
	const selectedAzureAuthenticationProfile = $derived(
		selectedCluster?.kind === 'log-analytics'
			? azureAuthenticationProfiles.profiles.find(
					(profile) => profile.id === selectedCluster.logAnalytics?.authenticationProfileId
				)
			: undefined
	);

	function openAddCluster() {
		editingCluster = undefined;
		connectionDialogOpen = true;
	}

	function openRemoveCluster(cluster: KustoClusterConnection) {
		removingCluster = cluster;
		removeClusterOpen = true;
	}

	function openAuthenticationProfileLink(cluster: KustoClusterConnection) {
		linkingCluster = cluster;
		linkProfileId = '';
		linkProfileOpen = true;
	}

	onMount(() => {
		function handleSessionRemoval(event: Event) {
			const { id } = (event as CustomEvent<{ id?: string }>).detail ?? {};
			const cluster = clusters.find(
				(item) =>
					item.id === selectedClusterId &&
					item.kind === 'log-analytics' &&
					item.logAnalytics?.authenticationProfileId === id
			);
			if (cluster) openAuthenticationProfileLink(cluster);
		}

		window.addEventListener('kite:azure-authentication-profile-removed', handleSessionRemoval);
		return () => window.removeEventListener('kite:azure-authentication-profile-removed', handleSessionRemoval);
	});

	function linkAuthenticationProfile() {
		if (!linkingCluster || !linkProfileId) return;
		onlinkauthenticationprofile?.(linkingCluster.id, linkProfileId);
		linkProfileOpen = false;
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
		if (cluster?.kind === 'log-analytics') return 'Azure Log Analytics workspace';
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
							{:else if selectedCluster?.kind === 'log-analytics'}
								<CloudCogIcon class="size-4" />
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
											if (disabled || locked) return;

											const hasLogAnalyticsAuthenticationProfile =
												cluster.kind !== 'log-analytics' ||
												azureAuthenticationProfiles.profiles.some(
													(profile) => profile.id === cluster.logAnalytics?.authenticationProfileId
												);
											if (!hasLogAnalyticsAuthenticationProfile) {
												openAuthenticationProfileLink(cluster);
												return;
											}

											onclusterchange?.(cluster.id);
										}}
									>
										{#if cluster.kind === 'mock'}
											<FlaskConicalIcon class="size-4" />
										{:else if cluster.kind === 'emulated'}
											<CpuIcon class="size-4" />
										{:else if cluster.kind === 'log-analytics'}
											<CloudCogIcon class="size-4" />
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
									{#if cluster.kind === 'emulated'}
										<span class="text-background/80">
											{cluster.emulatedStorage?.mode === 'opfs'
												? 'Persistent data survives cluster switches; only the active cluster keeps a DuckDB worker.'
												: 'Ephemeral data is cleared when you switch clusters or leave the workspace.'}
										</span>
									{/if}
								</div>
							</Tooltip.Content>
						</Tooltip.Root>
					{/each}
				</DropdownMenu.Group>
				<DropdownMenu.Separator />
				{#if selectedCluster?.kind === 'log-analytics' && selectedCluster.logAnalytics && selectedAzureAuthenticationProfile}
					<DropdownMenu.Group>
						<DropdownMenu.GroupHeading
							class="text-muted-foreground px-2 py-1.5 text-xs font-medium"
						>
							Authentication Status
						</DropdownMenu.GroupHeading>
						<div class="px-2 py-1 text-xs">
							<p class="font-medium">Using profile {selectedAzureAuthenticationProfile.name}</p>
							{#if selectedAzureAuthenticationProfile.account}
								<p class="mt-0.5 flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
									<CircleCheckIcon class="size-3.5 shrink-0" aria-hidden="true" />
									<span class="truncate">
										Signed in as {selectedAzureAuthenticationProfile.account.name ??
											selectedAzureAuthenticationProfile.account.username}{selectedAzureAuthenticationProfile.account.name &&
										selectedAzureAuthenticationProfile.account.username
											? ` (${selectedAzureAuthenticationProfile.account.username})`
											: ''}
									</span>
								</p>
							{:else}
								<p class="mt-0.5 flex items-center gap-1 text-amber-700 dark:text-amber-300">
									<CircleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
									<span>Sign in required</span>
								</p>
							{/if}
						</div>
					</DropdownMenu.Group>
					<DropdownMenu.Separator />
				{/if}
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
	onedit={onclusteredit}
	onremove={openRemoveCluster}
/>
<RemoveClusterDialog
	bind:open={removeClusterOpen}
	cluster={removingCluster}
	isCurrent={removingCluster?.id === selectedClusterId}
	onconfirm={onclusterremove}
/>

<Dialog.Root bind:open={linkProfileOpen}>
	<Dialog.Content class="gap-0 sm:max-w-md" aria-describedby="link-session-description">
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title>Link authentication profile</Dialog.Title>
			<Dialog.Description id="link-session-description">
				Select the authentication profile to use before opening {linkingCluster?.name}.
			</Dialog.Description>
		</Dialog.Header>
		<div class="p-5">
			<Select.Root type="single" bind:value={linkProfileId}>
				<Select.Trigger class="w-full"
					><Select.Value placeholder="Choose an authentication profile" /></Select.Trigger
				>
				<Select.Content>
					{#each azureAuthenticationProfiles.profiles as profile (profile.id)}
						<Select.Item value={profile.id} label={profile.name} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<Dialog.Footer class="border-t p-4">
			<Button variant="outline" onclick={() => (linkProfileOpen = false)}>Cancel</Button>
			<Button disabled={!linkProfileId} onclick={linkAuthenticationProfile}>Link and continue</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
