<script lang="ts">
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';

	import ThemeToggle from '$lib/components/shared/theme-toggle.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sidebar from '$lib/components/ui/sidebar';

	const sidebar = Sidebar.useSidebar();
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
				<div class="flex items-center justify-between gap-4 px-2 py-1.5 text-sm">
					<span>Dark theme</span>
					<ThemeToggle />
				</div>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>
