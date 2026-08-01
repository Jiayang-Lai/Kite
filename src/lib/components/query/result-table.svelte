<script lang="ts">
	import { createTable, tableFeatures, type ColumnDef } from '@tanstack/svelte-table';
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import { get } from 'svelte/store';

	import type { QueryResult } from '$lib/types/query-result';
	import { cn } from '$lib/utils';

	type ResultTableProps = {
		result: QueryResult;
		class?: string;
	};

	let { result, class: className = '' }: ResultTableProps = $props();

	const features = tableFeatures({});
	let scrollElement = $state<HTMLDivElement>();
	const data = $derived(result.rows);
	const columns = $derived<ColumnDef<typeof features, unknown[]>[]>(
		result.columns.map((column, index) => ({
			id: `column-${index}`,
			accessorFn: (row) => row[index],
			header: column.name
		}))
	);
	const columnTemplate = $derived(
		`repeat(${Math.max(result.columns.length, 1)}, minmax(8rem, 24rem))`
	);

	const table = createTable({
		features,
		get columns() {
			return columns;
		},
		get data() {
			return data;
		},
		getRowId: (_, index) => String(index)
	});
	const rows = $derived(table.getRowModel().rows);
	const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLTableRowElement>({
		count: 0,
		getScrollElement: () => null,
		estimateSize: () => 33,
		getItemKey: (index) => String(index),
		overscan: 8
	});

	$effect(() => {
		get(rowVirtualizer).setOptions({
			count: rows.length,
			getScrollElement: () => scrollElement ?? null,
			getItemKey: (index) => rows[index]?.id ?? String(index)
		});
	});

	function formatCell(value: unknown) {
		if (value === null || value === undefined) return 'null';
		if (typeof value === 'string') return value;
		if (typeof value === 'object') {
			try {
				return JSON.stringify(value);
			} catch {
				return String(value);
			}
		}
		return String(value);
	}

	function columnIndex(id: string) {
		return Number(id.slice('column-'.length));
	}
</script>

<div
	bind:this={scrollElement}
	class={cn('h-full min-h-0 overflow-auto overscroll-contain', className)}
	data-testid="result-table-scroll-viewport"
>
	<table class="grid min-w-full w-max border-collapse text-left text-xs">
		<thead class="bg-muted/95 sticky top-0 z-10 grid border-b shadow-xs backdrop-blur-sm">
			{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
				<tr class="grid" style:grid-template-columns={columnTemplate}>
					{#each headerGroup.headers as header (header.id)}
						{@const index = columnIndex(header.column.id)}
						{@const column = result.columns[index]}
						<th class="min-w-0 border-r px-2 py-1.5 font-medium last:border-r-0" scope="col">
							<span class="block truncate whitespace-nowrap"
								>{column?.name ?? header.column.id}</span
							>
							<span class="text-muted-foreground block truncate font-mono text-[9px] font-normal">
								{column?.type ?? 'unknown'}
							</span>
						</th>
					{/each}
				</tr>
			{/each}
		</thead>
		<tbody class="relative block" style:height={`${$rowVirtualizer.getTotalSize()}px`}>
			{#each $rowVirtualizer.getVirtualItems() as virtualRow (virtualRow.key)}
				{@const row = rows[virtualRow.index]}
				{#if row}
					<tr
						class="hover:bg-muted/40 absolute left-0 grid w-max min-w-full"
						style:grid-template-columns={columnTemplate}
						style:height={`${virtualRow.size}px`}
						style:transform={`translateY(${virtualRow.start}px)`}
					>
						{#each row.getAllCells() as cell (cell.id)}
							{@const value = formatCell(cell.getValue())}
							<td
								class={cn(
									'min-w-0 truncate border-r border-b px-2 py-1.5 font-mono whitespace-nowrap last:border-r-0',
									(cell.getValue() === null || cell.getValue() === undefined) &&
										'text-muted-foreground italic'
								)}
								title={value}
							>
								{value}
							</td>
						{/each}
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
</div>
