<script lang="ts">
	import type { ConfirmationPrompt } from '$lib/app/confirmation-prompt.svelte';
	import ConfirmationDialog from '$lib/components/admin/confirmation-dialog.svelte';

	let { prompt }: { prompt: ConfirmationPrompt } = $props();
</script>

{#if prompt.request}
	<ConfirmationDialog
		bind:open={
			() => Boolean(prompt.request),
			(open) => {
				// Closing without submitting (Cancel, Escape, or the overlay) declines the request.
				if (!open) prompt.respond(false);
			}
		}
		title={prompt.request.title}
		description={prompt.request.description}
		descriptionId="confirmation-prompt-description"
		actionLabel={prompt.request.actionLabel}
		variant={prompt.request.variant ?? 'destructive'}
		onsubmit={() => prompt.respond(true)}
	/>
{/if}
