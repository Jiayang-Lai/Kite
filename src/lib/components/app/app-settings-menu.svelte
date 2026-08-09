<script lang="ts">
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import LogOutIcon from '@lucide/svelte/icons/log-out';

	import { azureMsalClientManager } from '$lib/azure-auth/msal-client-manager';
	import { getAzureAuthenticationProfileStore } from '$lib/azure-auth/profile-store.svelte';
	import ThemeToggle from '$lib/components/shared/theme-toggle.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import * as Sidebar from '$lib/components/ui/sidebar';

	const sidebar = Sidebar.useSidebar();
	const azureAuthenticationProfiles = getAzureAuthenticationProfileStore();
	let authenticationProfileDialogOpen = $state(false);
	let name = $state('');
	let tenantId = $state('');
	let clientId = $state('');
	let profileView = $state<'current' | 'new'>('current');
	let profileToRemove = $state<(typeof azureAuthenticationProfiles.profiles)[number]>();
	let profileAuthenticationError = $state('');
	let signingOutProfileId = $state<string>();
	function addAuthenticationProfile() {
		if (!name.trim() || !tenantId.trim() || !clientId.trim()) return;
		azureAuthenticationProfiles.add({ name: name.trim(), tenantId: tenantId.trim(), clientId: clientId.trim() });
		name = tenantId = clientId = '';
		profileView = 'current';
	}
	async function signIn(profile: { id: string; tenantId: string; clientId: string }) {
		profileAuthenticationError = '';
		try {
			const result = await azureMsalClientManager.signIn({
				workspaceId: '',
				tenantId: profile.tenantId,
				clientId: profile.clientId
			});
			azureAuthenticationProfiles.bindAccount(
				profile.id,
				azureMsalClientManager.toBinding(result.account)
			);
		} catch (cause) {
			profileAuthenticationError =
				cause instanceof Error ? cause.message : 'Microsoft Entra sign-in failed.';
		}
	}
	function matchingProfiles(profile: {
		id: string;
		tenantId: string;
		clientId: string;
		account?: import('$lib/kusto/query-client').LogAnalyticsAccountBinding;
	}) {
		const account = profile.account;
		return account
			? azureAuthenticationProfiles.profiles.filter(
					(candidate) =>
						candidate.account?.homeAccountId === account.homeAccountId &&
						candidate.account?.tenantId === account.tenantId
				)
			: [profile];
	}

	async function signOutOfKite(profile: {
		id: string;
		tenantId: string;
		clientId: string;
		account?: import('$lib/kusto/query-client').LogAnalyticsAccountBinding;
	}) {
		profileAuthenticationError = '';
		const account = profile.account;
		const profiles = matchingProfiles(profile);
		if (account) azureAuthenticationProfiles.clearAccountBindings(account);
		else azureAuthenticationProfiles.clearAccount(profile.id);

		try {
			await Promise.all(
				profiles
					.map((candidate) =>
						azureMsalClientManager.clearAccountCache({
							workspaceId: '',
							tenantId: candidate.tenantId,
							clientId: candidate.clientId,
							account: candidate.account
						})
					)
			);
		} catch {
				profileAuthenticationError =
					'Kite removed the saved sign-in, but could not clear all local Microsoft Entra cache entries.';
		}
	}

	async function signOutOfMicrosoftEntra(profile: {
		id: string;
		tenantId: string;
		clientId: string;
		account?: import('$lib/kusto/query-client').LogAnalyticsAccountBinding;
	}) {
		if (signingOutProfileId) return;
		profileAuthenticationError = '';
		signingOutProfileId = profile.id;
		const account = profile.account;
		const profiles = matchingProfiles(profile);
		const logout = azureMsalClientManager.signOutEverywhere({
			workspaceId: '',
			tenantId: profile.tenantId,
			clientId: profile.clientId,
			account
		});

		// MSAL clears the selected account's cache as it starts the server logout.
		// Update Kite immediately so a closed popup never leaves an authenticated UI state.
		if (account) azureAuthenticationProfiles.clearAccountBindings(account);
		else azureAuthenticationProfiles.clearAccount(profile.id);

		try {
			await logout;
			await Promise.all(
				profiles
					.filter(
						(candidate) =>
							candidate.tenantId !== profile.tenantId || candidate.clientId !== profile.clientId
					)
					.map((candidate) =>
						azureMsalClientManager.clearAccountCache({
							workspaceId: '',
							tenantId: candidate.tenantId,
							clientId: candidate.clientId,
							account: candidate.account
						})
					)
			);
		} catch (cause) {
			profileAuthenticationError =
				cause instanceof Error
					? cause.message
					: 'Microsoft Entra browser sign-out did not complete.';
		} finally {
			signingOutProfileId = undefined;
		}
	}

	async function stopWaitingForMicrosoftEntraSignOut(profile: {
		id: string;
		tenantId: string;
		clientId: string;
	}) {
		if (signingOutProfileId !== profile.id) return;
		await azureMsalClientManager.stopWaitingForSignOut({
			workspaceId: '',
			tenantId: profile.tenantId,
			clientId: profile.clientId
		});
		signingOutProfileId = undefined;
		profileAuthenticationError =
			'Kite is signed out locally. Microsoft Entra browser sign-out may not have completed.';
	}

	function removeProfile(shouldSignOut: boolean) {
		if (!profileToRemove) return;
		const profile = profileToRemove;
		if (shouldSignOut) {
			signOutOfKite(profile);
			azureAuthenticationProfiles.remove(profile.id);
		} else azureAuthenticationProfiles.remove(profile.id);
		profileToRemove = undefined;
	}
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton {...props} size="lg" tooltipContent="Settings">
						<div class="flex size-8 shrink-0 items-center justify-center">
							<Settings2Icon />
						</div>
						<div class="grid flex-1 text-left text-sm leading-tight">
							<span class="truncate font-medium">Settings</span>
							<span class="text-muted-foreground truncate text-xs">Tinker tinker</span>
						</div>
						<ChevronsUpDownIcon class="ms-auto size-4" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>

			<DropdownMenu.Content side={sidebar.isMobile ? 'bottom' : 'right'} align="end" sideOffset={4}>
				<DropdownMenu.Label>Kite settings</DropdownMenu.Label>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onSelect={() => (authenticationProfileDialogOpen = true)}
					>Azure authentication profiles</DropdownMenu.Item
				>
				<DropdownMenu.Separator />
				<div class="flex items-center justify-between gap-4 px-2 py-1.5 text-sm">
					<span>Dark theme</span>
					<ThemeToggle />
				</div>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>

<Dialog.Root bind:open={authenticationProfileDialogOpen}>
	<Dialog.Content class="gap-0 sm:max-w-3xl" aria-describedby="azure-authentication-profiles-description">
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title>Azure authentication profiles</Dialog.Title>
			<Dialog.Description id="azure-authentication-profiles-description">
				Create reusable Microsoft Entra authentication profiles for Analytics connections.
			</Dialog.Description>
		</Dialog.Header>
		<div class="grid min-h-80 grid-cols-[11rem_minmax(0,1fr)]">
			<nav class="border-r p-3" aria-label="Azure authentication profile views">
				<div class="grid gap-1">
					<Button
						variant={profileView === 'current' ? 'secondary' : 'ghost'}
						class="justify-start"
						onclick={() => (profileView = 'current')}>Current profiles</Button
					>
					<Button
						variant={profileView === 'new' ? 'secondary' : 'ghost'}
						class="justify-start"
						onclick={() => (profileView = 'new')}>New profile</Button
					>
				</div>
			</nav>
			<section class="max-h-[min(65dvh,32rem)] overflow-y-auto p-5">
				{#if profileView === 'current'}
					<div class="mb-4">
						<h3 class="text-sm font-medium">Current profiles</h3>
						<p class="text-muted-foreground mt-1 text-sm">
							Reusable Microsoft Entra authentication profiles saved in this browser.
						</p>
					</div>
					{#if profileAuthenticationError}
						<p class="border-destructive/30 bg-destructive/10 text-destructive mb-4 rounded-md border px-3 py-2 text-sm" role="alert">
							{profileAuthenticationError}
						</p>
					{/if}
					{#if profileToRemove}
						<div class="grid gap-5 rounded-md border p-4">
							<div>
								<h4 class="text-sm font-medium">Remove {profileToRemove.name}?</h4>
								<p class="text-muted-foreground mt-1 text-sm">
									Remove this Kite profile only, or also clear its Kite sign-in.
								</p>
							</div>
							<div class="flex flex-wrap justify-end gap-2">
								<Button variant="outline" onclick={() => (profileToRemove = undefined)}>Cancel</Button>
								<Button variant="outline" onclick={() => removeProfile(false)}>Remove profile only</Button>
								<Button variant="destructive" onclick={() => removeProfile(true)}>Remove and clear Kite sign-in</Button>
							</div>
						</div>
					{:else}
						<div class="divide-y rounded-md border">
							{#each azureAuthenticationProfiles.profiles as profile (profile.id)}
								<div class="flex items-center gap-3 p-3">
									<div class="min-w-0 flex-1">
										<p class="text-sm font-medium">{profile.name}</p>
										{#if profile.account}
											<p class="text-muted-foreground truncate text-xs">
												Signed in as {profile.account.username}
											</p>
										{/if}
										<p class="text-muted-foreground truncate text-xs">
											Tenant ID: {profile.tenantId}
										</p>
										<p class="text-muted-foreground truncate text-xs">
											Application ID: {profile.clientId}
										</p>
									</div>
									{#if signingOutProfileId === profile.id}
										<div class="flex items-center gap-2">
											<span class="text-muted-foreground text-xs">Waiting for Entra…</span>
											<Button variant="ghost" size="sm" onclick={() => stopWaitingForMicrosoftEntraSignOut(profile)}
												>Stop waiting</Button
											>
										</div>
									{:else if !profile.account}
										<Button variant="ghost" size="sm" onclick={() => signIn(profile)}
											><LogInIcon /> Sign in</Button
										>
									{:else}
										<Button variant="ghost" size="sm" onclick={() => signOutOfMicrosoftEntra(profile)}
											><LogOutIcon /> Sign out</Button
										>
									{/if}
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Remove ${profile.name}`}
										onclick={() => (profileToRemove = profile)}><Trash2Icon /></Button
									>
								</div>
							{:else}
								<p class="text-muted-foreground p-6 text-center text-sm">
									No Azure authentication profiles have been created.
								</p>
							{/each}
						</div>
					{/if}
				{:else}
					<div class="mb-5">
						<h3 class="text-sm font-medium">New Azure authentication profile</h3>
						<p class="text-muted-foreground mt-1 text-sm">
							Create a reusable Microsoft Entra authentication profile.
						</p>
					</div>
					<div class="grid gap-3">
						<Input placeholder="Session name" bind:value={name} /><Input
							placeholder="Tenant ID or domain"
							bind:value={tenantId}
						/><Input placeholder="Application (client) ID" bind:value={clientId} />
					</div>
				{/if}
			</section>
		</div>
		<Dialog.Footer class="border-t p-4">
			<Button variant="outline" onclick={() => (authenticationProfileDialogOpen = false)}
				>{profileView === 'new' ? 'Cancel' : 'Done'}</Button
			>
			{#if profileView === 'new'}<Button onclick={addAuthenticationProfile}>Create profile</Button>{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
