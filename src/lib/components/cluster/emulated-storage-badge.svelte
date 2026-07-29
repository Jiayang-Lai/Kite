<script lang="ts">
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import MemoryStickIcon from '@lucide/svelte/icons/memory-stick';

	import { Badge } from '$lib/components/ui/badge';
	import type { EmulatedStorage } from '$lib/emulated/storage';
	import { cn } from '$lib/utils.js';

	type EmulatedStorageBadgeProps = {
		storage?: EmulatedStorage;
		class?: string;
	};

	let { storage, class: className }: EmulatedStorageBadgeProps = $props();
	const persistent = $derived(storage?.mode === 'opfs');
	const description = $derived(
		persistent
			? 'Stored in private browser storage and restored after reloads'
			: 'Held in memory and cleared when you switch clusters, leave the workspace, or reload'
	);
</script>

<Badge
	variant="outline"
	class={cn(
		persistent
			? 'border-primary/30 bg-primary/5 text-primary'
			: 'border-warning/30 bg-warning/5 text-warning',
		className
	)}
	title={description}
	data-emulated-storage={persistent ? 'persistent' : 'ephemeral'}
>
	{#if persistent}
		<HardDriveIcon />
		Persistent
	{:else}
		<MemoryStickIcon />
		Ephemeral
	{/if}
</Badge>
