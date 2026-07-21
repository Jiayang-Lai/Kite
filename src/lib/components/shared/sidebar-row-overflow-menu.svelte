<script lang="ts">
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import type { LucideIcon } from '@lucide/svelte';

	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	type SidebarRowOverflowMenuProps = {
		label: string;
		header?: string;
		actions?: SidebarRowMenuAction[];
	};

	type SidebarRowMenuAction = {
		id: string;
		label: string;
		icon?: LucideIcon;
		variant?: 'default' | 'destructive';
		disabled?: boolean;
		onSelect: () => void;
	};

	let { label, header, actions = [] }: SidebarRowOverflowMenuProps = $props();
</script>

{#if actions.length}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<button
					type="button"
					{...props}
					class="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md opacity-0 outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-2 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100 pointer-events-none"
					aria-label={`More actions for ${label}`}
					title={`More actions for ${label}`}
				>
					<EllipsisIcon class="size-4" />
				</button>
			{/snippet}
		</DropdownMenu.Trigger>

		<DropdownMenu.Content align="end" class="w-40">
			{#if header}
				<DropdownMenu.Label class="truncate" title={header}>{header}</DropdownMenu.Label>
				<DropdownMenu.Separator />
			{/if}
			{#each actions as action (action.id)}
				{@const Icon = action.icon}
				<DropdownMenu.Item
					variant={action.variant}
					disabled={action.disabled}
					onSelect={action.onSelect}
				>
					{#if Icon}<Icon class="size-4" />{/if}
					{action.label}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/if}
