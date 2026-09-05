<script lang="ts">
	import ConfirmationDialog from '$lib/components/admin/confirmation-dialog.svelte';
	import { Input } from '$lib/components/ui/input';
	import type {
		DatabaseMutationAction,
		DatabaseMutationRequest
	} from '$lib/admin/mutation-contracts';

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
	let initializedTarget = '';
	const title = $derived(
		action === 'create'
			? 'Create database'
			: action === 'rename'
				? renameMode === 'display-name'
					? 'Edit database display name'
					: 'Rename database'
				: 'Delete database'
	);
	const description = $derived(
		action === 'drop'
			? clusterKind === 'mock'
				? `Permanently remove ${databaseName} and all of its schema metadata from this browser.`
				: clusterKind === 'emulated'
					? `Permanently remove ${databaseName} and all of its browser DuckDB data.`
					: 'Remote database deletion is not available for the local backend.'
			: clusterKind === 'mock'
				? 'This changes schema metadata in this browser only.'
				: clusterKind === 'emulated'
					? 'This creates an attached DuckDB database for the current browser connection.'
					: renameMode === 'display-name' && action === 'rename'
						? 'This changes the friendly display name, not the canonical database identifier.'
						: 'Remote database creation is not available for the local backend.'
	);

	$effect(() => {
		if (!open) {
			initializedTarget = '';
			return;
		}
		const target = `${clusterKind}:${action}:${databaseName ?? ''}:${initialName ?? ''}`;
		if (target === initializedTarget) return;
		initializedTarget = target;
		name = action === 'rename' ? (initialName ?? databaseName ?? '') : '';
	});
</script>

<ConfirmationDialog
	bind:open
	{title}
	{description}
	descriptionId="database-mutation-description"
	actionLabel={action === 'create'
		? 'Create database'
		: action === 'rename'
			? renameMode === 'display-name'
				? 'Update display name'
				: 'Rename database'
			: 'Delete database'}
	variant={action === 'drop' ? 'destructive' : 'default'}
	confirmationPhrase={action === 'drop' ? databaseName : undefined}
	confirmationLabel={`Type ${databaseName} to confirm`}
	onsubmit={() => onsubmit?.({ name: action === 'drop' ? undefined : name })}
>
	{#if action !== 'drop'}
		<div class="grid gap-1.5">
			<label class="text-sm font-medium" for="database-mutation-name">
				{action === 'rename' && renameMode === 'display-name' ? 'Display name' : 'Database name'}
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
</ConfirmationDialog>
