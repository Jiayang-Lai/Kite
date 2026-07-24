<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';

	export type MockDatabaseAction = 'create' | 'rename' | 'drop';

	type MockDatabaseDialogProps = {
		open?: boolean;
		action: MockDatabaseAction;
		databaseName?: string;
		onsubmit?: (name?: string) => Promise<void> | void;
	};

	let {
		open = $bindable(false),
		action,
		databaseName,
		onsubmit
	}: MockDatabaseDialogProps = $props();
	let name = $state('');
	let confirmation = $state('');
	let error = $state('');
	let isSubmitting = $state(false);
	let initializedTarget = '';

	$effect(() => {
		if (!open) {
			initializedTarget = '';
			return;
		}
		const target = `${action}:${databaseName ?? ''}`;
		if (target === initializedTarget) return;
		initializedTarget = target;
		name = action === 'rename' ? (databaseName ?? '') : '';
		confirmation = '';
		error = '';
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (isSubmitting) return;
		error = '';
		isSubmitting = true;
		try {
			await onsubmit?.(action === 'drop' ? undefined : name);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			isSubmitting = false;
		}
	}

	const title = $derived(
		action === 'create'
			? 'Create mock database'
			: action === 'rename'
				? 'Rename mock database'
				: 'Delete mock database'
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="gap-0 sm:max-w-md" aria-describedby="mock-database-dialog-description">
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description id="mock-database-dialog-description">
				{action === 'drop'
					? `Permanently remove ${databaseName} and all of its schema metadata from this browser.`
					: 'This changes schema metadata in this browser only.'}
			</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={submit}>
			<div class="space-y-4 p-5">
				{#if action === 'drop'}
					<div class="space-y-1.5">
						<label class="text-sm font-medium" for="mock-database-confirmation">
							Type <span class="font-mono">{databaseName}</span> to confirm
						</label>
						<Input
							id="mock-database-confirmation"
							bind:value={confirmation}
							autocomplete="off"
							required
						/>
					</div>
				{:else}
					<div class="space-y-1.5">
						<label class="text-sm font-medium" for="mock-database-name">Database name</label>
						<Input
							id="mock-database-name"
							bind:value={name}
							autocomplete="off"
							required
							maxlength={100}
						/>
					</div>
				{/if}

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
					variant={action === 'drop' ? 'destructive' : 'default'}
					disabled={isSubmitting || (action === 'drop' && confirmation !== databaseName)}
				>
					{action === 'create'
						? 'Create database'
						: action === 'rename'
							? 'Rename database'
							: 'Delete database'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
