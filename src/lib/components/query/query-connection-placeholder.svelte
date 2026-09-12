<script lang="ts">
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';

	type QueryConnectionPlaceholderProps = {
		status: 'loading' | 'ready' | 'error';
		clusterName: string;
		error?: string;
		showSignInTip?: boolean;
		onretry: () => void;
	};

	let {
		status,
		clusterName,
		error = '',
		showSignInTip = false,
		onretry
	}: QueryConnectionPlaceholderProps = $props();
</script>

<section
	class="flex h-full min-h-0 items-center justify-center bg-background p-6"
	aria-live="polite"
>
	{#if status === 'loading'}
		<div class="text-muted-foreground flex flex-col items-center gap-3 text-sm">
			<Spinner class="size-6" />
			<p>Connecting to {clusterName}…</p>
			{#if showSignInTip}
				<div
					class="flex max-w-sm items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-left text-xs"
				>
					<LightbulbIcon class="mt-0.5 size-4 shrink-0 text-primary" />
					<p>
						<span class="font-medium">Tip:</span> Check for potential Microsoft Entra sign-in pop-up to
						continue.
					</p>
				</div>
			{/if}
		</div>
	{:else}
		<div class="max-w-md text-center">
			<h2 class="font-semibold">Could not connect to Kusto</h2>
			<p class="text-muted-foreground mt-2 text-sm">{error}</p>
			<Button class="mt-4" variant="outline" onclick={onretry}>
				<RefreshCwIcon />
				Retry
			</Button>
		</div>
	{/if}
</section>
