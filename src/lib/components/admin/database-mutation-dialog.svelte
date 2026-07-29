<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';

	export type DatabaseMutationAction = 'create' | 'rename' | 'drop';
	export type DatabaseMutationRequest = {
		name?: string;
	};

	type DatabaseMutationDialogProps = {
		open?: boolean;
		action: DatabaseMutationAction;
		databaseName?: string;
		initialName?: string;
		clusterKind: 'mock' | 'emulated' | 'remote';
		renameMode?: 'canonical' | 'display-name';
		onsubmit?: (request: DatabaseMutationRequest) => Promise<void> | void;
	};

	let {
		open = $bindable(false),
		action,
		databaseName,
		initialName,
		clusterKind,
		renameMode = 'canonical',
		onsubmit
	}: DatabaseMutationDialogProps = $props();
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
		const target = `${clusterKind}:${action}:${databaseName ?? ''}:${initialName ?? ''}`;
		if (target === initializedTarget) return;
		initializedTarget = target;
		name = action === 'rename' ? (initialName ?? databaseName ?? '') : '';
		confirmation = '';
		error = '';
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (isSubmitting) return;
		error = '';
		isSubmitting = true;
		try {
			await onsubmit?.({
				name: action === 'drop' ? undefined : name
			});
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			isSubmitting = false;
		}
	}

	const title = $derived(
		action === 'create'
			? 'Create database'
			: action === 'rename'
				? renameMode === 'display-name'
					? 'Edit database display name'
					: 'Rename database'
				: 'Delete database'
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="gap-0 sm:max-w-md" aria-describedby="database-mutation-description">
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description id="database-mutation-description">
				{action === 'drop'
					? clusterKind === 'mock'
						? `Permanently remove ${databaseName} and all of its schema metadata from this browser.`
						: clusterKind === 'emulated'
							? `Permanently remove ${databaseName} and all of its browser DuckDB data.`
							: `Remote database deletion is not available for the local backend.`
					: clusterKind === 'mock'
						? 'This changes schema metadata in this browser only.'
						: clusterKind === 'emulated'
							? 'This creates an attached DuckDB database for the current browser connection.'
							: renameMode === 'display-name' && action === 'rename'
								? 'This changes the friendly display name, not the canonical database identifier.'
								: 'Remote database creation is not available for the local backend.'}
			</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={submit}>
			<div class="space-y-4 p-5">
				{#if action === 'drop'}
					<div class="grid gap-1.5">
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
					<div class="grid gap-1.5">
						<label class="text-sm font-medium" for="database-mutation-name">
							{action === 'rename' && renameMode === 'display-name'
								? 'Display name'
								: 'Database name'}
						</label>
						<Input
							id="database-mutation-name"
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
							? renameMode === 'display-name'
								? 'Update display name'
								: 'Rename database'
							: 'Delete database'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
