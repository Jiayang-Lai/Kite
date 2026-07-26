<script lang="ts">
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import FilePenLineIcon from '@lucide/svelte/icons/file-pen-line';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	type DatabaseAction = 'rename' | 'drop';

	type DatabaseActionsMenuProps = {
		databaseName: string;
		renameLabel?: string;
		renameDisabled?: boolean;
		showDrop?: boolean;
		dropDisabled?: boolean;
		dropDisabledReason?: string;
		disabled?: boolean;
		onaction?: (action: DatabaseAction) => void;
	};

	let {
		databaseName,
		renameLabel = 'Rename database',
		renameDisabled = false,
		showDrop = true,
		dropDisabled = false,
		dropDisabledReason,
		disabled = false,
		onaction
	}: DatabaseActionsMenuProps = $props();
	let open = $state(false);

	function selectAction(action: DatabaseAction) {
		open = false;
		setTimeout(() => onaction?.(action));
	}
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon-xs"
				{disabled}
				class="pointer-events-none absolute top-1/2 right-1 z-10 -translate-y-1/2 opacity-0 transition-opacity group-focus-within/database-row:pointer-events-auto group-focus-within/database-row:opacity-100 group-hover/database-row:pointer-events-auto group-hover/database-row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
				aria-label={`More actions for database ${databaseName}`}
				title={`More actions for database ${databaseName}`}
			>
				<EllipsisIcon />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-52">
		<DropdownMenu.Label class="truncate" title={databaseName}>
			Actions for {databaseName}
		</DropdownMenu.Label>
		<DropdownMenu.Separator />
		<DropdownMenu.Item disabled={renameDisabled} onSelect={() => selectAction('rename')}>
			<FilePenLineIcon />
			{renameLabel}
		</DropdownMenu.Item>
		{#if showDrop}
			<DropdownMenu.Separator />
			<DropdownMenu.Item
				variant="destructive"
				disabled={dropDisabled}
				title={dropDisabled ? dropDisabledReason : undefined}
				onSelect={() => selectAction('drop')}
			>
				<Trash2Icon />
				Delete database
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
