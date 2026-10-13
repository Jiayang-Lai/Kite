<script lang="ts">
	import type { ConfirmationPrompt } from '$lib/app/confirmation-prompt.svelte';
	import ConfirmationDialog from '$lib/components/admin/confirmation-dialog.svelte';

	let { prompt }: { prompt: ConfirmationPrompt } = $props();
</script>

<!-- Keyed by request: each question gets its own dialog, and its close only answers that question. -->
{#each prompt.request ? [prompt.request] : [] as request (request)}
	<ConfirmationDialog
		bind:open={
			() => prompt.request === request,
			(open) => {
				// Closing without submitting (Cancel, Escape, or the overlay) declines the request.
				if (!open) prompt.respond(false, request);
			}
		}
		title={request.title}
		description={request.description}
		descriptionId="confirmation-prompt-description"
		actionLabel={request.actionLabel}
		variant={request.variant ?? 'destructive'}
		onsubmit={() => prompt.respond(true, request)}
	/>
{/each}
