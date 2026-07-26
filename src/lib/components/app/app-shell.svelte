<script lang="ts">
	import type { Snippet } from 'svelte';

	import { getAppShellState } from '$lib/app/app-shell-state.svelte';
	import AppSettingsMenu from '$lib/components/app/app-settings-menu.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';

	type AppShellProps = {
		sidebarHeader?: Snippet;
		sidebarContent?: Snippet;
		children: Snippet;
	};

	let { sidebarHeader, sidebarContent, children }: AppShellProps = $props();
	const appShellState = getAppShellState();
</script>

<Sidebar.Provider bind:open={appShellState.sidebarOpen} class="h-dvh min-h-0 bg-muted/30">
	<Sidebar.Root collapsible="icon">
		<Sidebar.Header class="shrink-0 px-2 pt-2 pb-1">
			{@render sidebarHeader?.()}
		</Sidebar.Header>

		{@render sidebarContent?.()}

		<Sidebar.Footer>
			<AppSettingsMenu />
		</Sidebar.Footer>
		<Sidebar.Rail />
	</Sidebar.Root>

	<Sidebar.Inset class="min-h-0 gap-2 overflow-hidden bg-muted/30 p-1.5 sm:p-2 md:p-3 lg:p-4">
		{@render children()}
	</Sidebar.Inset>
</Sidebar.Provider>
