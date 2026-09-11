<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	type SaveQueryDialogProps = {
		dialogOpen: boolean;
		name: string;
		nameError: string;
		database?: string;
		onsave: () => void;
	};

	let {
		dialogOpen = $bindable(),
		name = $bindable(),
		nameError,
		database,
		onsave
	}: SaveQueryDialogProps = $props();
</script>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="gap-0 overflow-hidden" aria-describedby="save-query-dialog-description">
		<form
			onsubmit={(event) => {
				event.preventDefault();
				onsave();
			}}
		>
			<Dialog.Header class="border-b p-5 pr-14">
				<Dialog.Title>Save query</Dialog.Title>
				<Dialog.Description id="save-query-dialog-description">
					Save this query locally for {database} on the current cluster.
				</Dialog.Description>
			</Dialog.Header>

			<div class="p-5">
				<label class="text-sm font-medium" for="saved-query-name">Query name</label>
				<Input
					id="saved-query-name"
					class="mt-2"
					bind:value={name}
					aria-invalid={Boolean(nameError)}
					aria-describedby={nameError ? 'saved-query-name-error' : undefined}
					placeholder="Name for this query"
					autocomplete="off"
				/>
				{#if nameError}
					<p id="saved-query-name-error" class="text-destructive mt-2 text-sm" role="alert">
						{nameError}
					</p>
				{/if}
			</div>

			<Dialog.Footer class="border-t p-4">
				<Button variant="outline" onclick={() => (dialogOpen = false)}>Cancel</Button>
				<Button type="submit">Save query</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
