<script lang="ts">
	import { createAsyncDialogAction } from '$lib/admin/async-dialog-action.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import type { Snippet } from 'svelte';

	type ConfirmationDialogProps = {
		open?: boolean;
		title: string;
		description: string;
		descriptionId: string;
		actionLabel: string;
		pendingLabel?: string;
		variant?: 'default' | 'destructive';
		confirmationPhrase?: string;
		confirmationLabel?: string;
		onsubmit?: () => Promise<void> | void;
		children?: Snippet;
	};

	let {
		open = $bindable(false),
		title,
		description,
		descriptionId,
		actionLabel,
		pendingLabel = actionLabel,
		variant = 'destructive',
		confirmationPhrase,
		confirmationLabel,
		onsubmit,
		children
	}: ConfirmationDialogProps = $props();
	let confirmation = $state('');
	const action = createAsyncDialogAction();

	$effect(() => {
		if (!open) return;
		confirmation = '';
		action.reset();
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (confirmationPhrase && confirmation !== confirmationPhrase) return;
		if (await action.submit(() => onsubmit?.())) open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="gap-0 sm:max-w-md" aria-describedby={descriptionId}>
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description id={descriptionId}>{description}</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={submit}>
			<div class="flex flex-col gap-4 p-5">
				{@render children?.()}
				{#if confirmationPhrase}
					<div class="grid gap-1.5">
						<label class="text-sm font-medium" for={`${descriptionId}-confirmation`}>
							{confirmationLabel ?? 'Type the confirmation phrase to continue'}
						</label>
						<Input
							id={`${descriptionId}-confirmation`}
							bind:value={confirmation}
							autocomplete="off"
							required
						/>
					</div>
				{/if}
				{#if action.state.error}
					<p class="text-destructive text-sm whitespace-pre-wrap" role="alert">
						{action.state.error}
					</p>
				{/if}
			</div>

			<Dialog.Footer class="border-t p-4">
				<Button
					type="button"
					variant="outline"
					disabled={action.state.isSubmitting}
					onclick={() => (open = false)}
				>
					Cancel
				</Button>
				<Button
					type="submit"
					{variant}
					disabled={action.state.isSubmitting ||
						Boolean(confirmationPhrase && confirmation !== confirmationPhrase)}
				>
					{action.state.isSubmitting ? pendingLabel : actionLabel}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
