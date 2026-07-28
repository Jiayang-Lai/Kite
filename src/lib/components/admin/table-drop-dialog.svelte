<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';

	type TableDropDialogProps = {
		open?: boolean;
		databaseName: string;
		tableName: string;
		clusterKind: 'mock' | 'emulated' | 'remote';
		onsubmit?: () => Promise<void> | void;
	};

	let {
		open = $bindable(false),
		databaseName,
		tableName,
		clusterKind,
		onsubmit
	}: TableDropDialogProps = $props();
	let confirmation = $state('');
	let error = $state('');
	let isSubmitting = $state(false);
	let initializedTarget = '';
	const confirmationPhrase = $derived(`REMOVE ${tableName}`);

	$effect(() => {
		if (!open) {
			initializedTarget = '';
			return;
		}
		const target = `${databaseName}:${tableName}`;
		if (target === initializedTarget) return;
		initializedTarget = target;
		confirmation = '';
		error = '';
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (isSubmitting || confirmation !== confirmationPhrase) return;
		error = '';
		isSubmitting = true;
		try {
			await onsubmit?.();
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			isSubmitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="gap-0 sm:max-w-md" aria-describedby="table-drop-description">
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title>Remove table</Dialog.Title>
			<Dialog.Description id="table-drop-description">
				{clusterKind === 'mock'
					? `Remove ${databaseName}.${tableName} from this browser-local schema.`
					: clusterKind === 'emulated'
						? `Permanently remove ${databaseName}.${tableName} and its browser DuckDB data.`
						: `Permanently delete ${databaseName}.${tableName} and all data stored in it.`}
			</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={submit}>
			<div class="space-y-4 p-5">
				<div class="grid gap-1.5">
					<label class="text-sm font-medium" for="table-drop-confirmation">
						Type <span class="font-mono">{confirmationPhrase}</span> to confirm
					</label>
					<Input
						id="table-drop-confirmation"
						bind:value={confirmation}
						autocomplete="off"
						required
					/>
				</div>

				{#if error}
					<p class="text-destructive text-sm whitespace-pre-wrap" role="alert">{error}</p>
				{/if}
			</div>

			<Dialog.Footer class="border-t p-4">
				<Button
					type="button"
					variant="outline"
					disabled={isSubmitting}
					onclick={() => (open = false)}
				>
					Cancel
				</Button>
				<Button
					type="submit"
					variant="destructive"
					disabled={isSubmitting || confirmation !== confirmationPhrase}
				>
					Remove table
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
