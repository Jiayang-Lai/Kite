<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';

	import EmulatedStorageBadge from '$lib/components/cluster/emulated-storage-badge.svelte';
	import { Button } from '$lib/components/ui/button';
	import type { EmulatedStorage } from '$lib/emulated/storage';

	type ConnectionStatusProps = {
		status: 'loading' | 'ready' | 'error';
		databaseCount: number;
		tableCount: number;
		functionCount: number;
		isQueryable: boolean;
		emulatedStorage?: EmulatedStorage;
		onretry?: () => void;
	};

	let {
		status,
		databaseCount,
		tableCount,
		functionCount,
		isQueryable,
		emulatedStorage,
		onretry
	}: ConnectionStatusProps = $props();

	const statusText = $derived.by(() => {
		if (status === 'loading') return 'Connecting…';
		if (status === 'error') return 'Connection failed';
		return 'Connected';
	});
</script>

<footer
	class="text-muted-foreground flex shrink-0 items-center justify-between gap-3 rounded-md border bg-background px-2 py-1.5 text-xs sm:px-3"
	aria-live="polite"
>
	<div class="flex min-w-0 items-center gap-2">
		<span
			class:animate-pulse={status === 'loading'}
			class:bg-amber-500={status === 'error'}
			class:bg-emerald-500={status === 'ready'}
			class:bg-muted-foreground={status === 'loading'}
			class="size-2 shrink-0 rounded-full"
			aria-hidden="true"
		></span>
		<span class="truncate">{statusText}</span>
	</div>
	<div class="text-muted-foreground ml-auto flex items-center gap-3">
		{#if emulatedStorage}
			<EmulatedStorageBadge storage={emulatedStorage} class="hidden sm:inline-flex" />
		{/if}
		<div class="flex items-center gap-1.5">
			{#if isQueryable}
				<CircleCheckIcon
					class="size-3.5 text-emerald-600 dark:text-emerald-400"
					aria-hidden="true"
				/>
				<span>Queryable</span>
			{:else}
				<CircleXIcon class="size-3.5" aria-hidden="true" />
				<span>Query execution unavailable</span>
			{/if}
		</div>
		{#if databaseCount || tableCount || functionCount}
			<div class="hidden items-center gap-3 sm:flex">
				<span>{databaseCount} {databaseCount === 1 ? 'database' : 'databases'}</span>
				<span>{tableCount} {tableCount === 1 ? 'table' : 'tables'}</span>
				<span>{functionCount} {functionCount === 1 ? 'function' : 'functions'}</span>
			</div>
		{/if}
	</div>
	{#if status === 'error' && onretry}
		<Button variant="ghost" size="sm" class="h-6 shrink-0 px-2 text-xs" onclick={onretry}>
			Retry
		</Button>
	{/if}
</footer>
