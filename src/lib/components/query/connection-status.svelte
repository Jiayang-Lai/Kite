<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import BinocularsIcon from '@lucide/svelte/icons/binoculars';
	import PlugZapIcon from '@lucide/svelte/icons/plug-zap';

	import EmulatedStorageBadge from '$lib/components/cluster/emulated-storage-badge.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import type { EmulatedStorage } from '$lib/emulation/storage';

	type ConnectionStatusProps = {
		status: 'loading' | 'ready' | 'error';
		databaseCount: number;
		tableCount: number;
		functionCount: number;
		database?: string;
		languageServiceStatus?: 'idle' | 'loading' | 'ready';
		isQueryable: boolean;
		emulatedStorage?: EmulatedStorage;
		emulatedResultsWarning?: boolean;
		onretry?: () => void;
	};

	let {
		status,
		databaseCount,
		tableCount,
		functionCount,
		database,
		languageServiceStatus = 'idle',
		isQueryable,
		emulatedStorage,
		emulatedResultsWarning = false,
		onretry
	}: ConnectionStatusProps = $props();

	const statusText = $derived.by(() => {
		if (status === 'loading') return 'Connecting…';
		if (status === 'error') return 'Connection failed';
		return 'Connected';
	});
</script>

<footer
	class="text-muted-foreground flex shrink-0 items-center justify-between gap-3 border-t bg-muted/30 px-2 py-1.5 text-xs sm:px-3"
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
		<span class="bg-border hidden h-4 w-px sm:block" aria-hidden="true"></span>
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
	</div>
	<div class="text-muted-foreground ml-auto flex items-center gap-3">
		{#if database}
			<span class="max-w-48 truncate" title={database}>Database: {database}</span>
		{/if}
		{#if emulatedStorage}
			<EmulatedStorageBadge storage={emulatedStorage} class="hidden sm:inline-flex" />
		{/if}
		{#if emulatedResultsWarning}
			<span
				class="text-warning inline-flex shrink-0"
				title="Emulated results may differ from Kusto because translation supports only a subset of operators and functions."
				aria-label="Warning: emulated results may differ from Kusto"
			>
				<PlugZapIcon class="size-3.5" />
			</span>
		{/if}
		<span class="bg-border hidden h-4 w-px sm:block" aria-hidden="true"></span>
		<span
			class="inline-flex shrink-0"
			title={`Kusto language service: ${languageServiceStatus}`}
			aria-label={`Kusto language service: ${languageServiceStatus}`}
		>
			{#if languageServiceStatus === 'loading'}
				<Spinner class="size-3.5" />
			{:else}
				<BinocularsIcon
					class={`size-3.5 ${languageServiceStatus === 'ready' ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
				/>
			{/if}
		</span>
		{#if databaseCount || tableCount || functionCount}
			<div class="hidden items-center gap-1.5 sm:flex">
				<span>{databaseCount} {databaseCount === 1 ? 'database' : 'databases'}</span>
				<span aria-hidden="true">·</span>
				<span>{tableCount} {tableCount === 1 ? 'table' : 'tables'}</span>
				<span aria-hidden="true">·</span>
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
