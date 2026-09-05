<script lang="ts">
	import BinaryIcon from '@lucide/svelte/icons/binary';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import FilePenLineIcon from '@lucide/svelte/icons/file-pen-line';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import type { ColumnMutationAction } from '$lib/admin/mutation-contracts';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import type { KustoColumn, KustoTable } from '$lib/types/kusto-schema';

	type ColumnActionsMenuProps = {
		table: KustoTable;
		column: KustoColumn;
		disabled?: boolean;
		onaction?: (action: ColumnMutationAction) => void;
	};

	let { table, column, disabled = false, onaction }: ColumnActionsMenuProps = $props();
	let open = $state(false);

	function selectAction(action: ColumnMutationAction) {
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
				aria-label={`More actions for ${table.name}.${column.name}`}
				title={`More actions for ${table.name}.${column.name}`}
			>
				<EllipsisIcon />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-52">
		<DropdownMenu.Label class="truncate" title={column.name}
			>Action for column {column.name}</DropdownMenu.Label
		>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={() => selectAction('rename')}>
			<FilePenLineIcon />
			Rename column
		</DropdownMenu.Item>
		<DropdownMenu.Item variant="destructive" onSelect={() => selectAction('change-type')}>
			<BinaryIcon />
			Change type
		</DropdownMenu.Item>
		<DropdownMenu.Separator />
		<DropdownMenu.Item
			variant="destructive"
			disabled={table.columns.length <= 1}
			onSelect={() => selectAction('drop')}
		>
			<Trash2Icon />
			Remove column
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
