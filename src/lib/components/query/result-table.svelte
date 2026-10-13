<script lang="ts">
	import { createTable, tableFeatures, type ColumnDef } from '@tanstack/svelte-table';
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import { tick } from 'svelte';
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
	let expandedRowId = $state<string>();
	const data = $derived(result.rows);
	const columns = $derived<ColumnDef<typeof features, unknown[]>[]>(
		result.columns.map((column, index) => ({
			id: `column-${index}`,
			accessorFn: (row) => row[index],
			header: column.name
		}))
	);
	const columnTemplate = $derived(
		`2.25rem repeat(${Math.max(result.columns.length, 1)}, minmax(8rem, 24rem))`
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

	$effect(() => {
		result;
		expandedRowId = undefined;
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

	function formatDetailCell(value: unknown) {
		if (value === null || value === undefined) return 'null';
		if (typeof value === 'object') {
			try {
				return JSON.stringify(value, null, 2);
			} catch {
				return String(value);
			}
		}
		return String(value);
	}

	function toggleRow(rowId: string) {
		expandedRowId = expandedRowId === rowId ? undefined : rowId;
		void tick().then(() => get(rowVirtualizer).measure());
	}

	function measureRow(node: HTMLTableRowElement) {
		get(rowVirtualizer).measureElement(node);
	}
</script>

<div
	bind:this={scrollElement}
	class={cn('h-full min-h-0 overflow-auto overscroll-contain', className)}
	data-testid="result-table-scroll-viewport"
>
	<table class="grid w-max min-w-full border-collapse text-left text-xs">
		<thead class="sticky top-0 z-10 grid border-b bg-muted/95 shadow-xs backdrop-blur-sm">
			{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
				<tr class="grid" style:grid-template-columns={columnTemplate}>
					<th class="border-r px-1" scope="col"><span class="sr-only">Inspect row</span></th>
					{#each headerGroup.headers as header (header.id)}
						{@const index = columnIndex(header.column.id)}
						{@const column = result.columns[index]}
						<th class="min-w-0 border-r px-2 py-1.5 font-medium last:border-r-0" scope="col">
							<span class="block truncate whitespace-nowrap"
								>{column?.name ?? header.column.id}</span
							>
							<span class="block truncate font-mono text-[9px] font-normal text-muted-foreground">
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
						use:measureRow
						data-index={virtualRow.index}
						class="absolute left-0 grid w-max min-w-full hover:bg-muted/40"
						style:grid-template-columns={columnTemplate}
						style:transform={`translateY(${virtualRow.start}px)`}
					>
						<td class="flex items-center justify-center border-r border-b px-1 py-1">
							<button
								type="button"
								class="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-1"
								onclick={() => toggleRow(row.id)}
								aria-label={expandedRowId === row.id
									? 'Collapse row details'
									: 'Inspect row details'}
								aria-expanded={expandedRowId === row.id}
							>
								{#if expandedRowId === row.id}
									<ChevronUpIcon class="size-4" />
								{:else}
									<ChevronDownIcon class="size-4" />
								{/if}
							</button>
						</td>
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
						{#if expandedRowId === row.id}
							<td class="col-span-full border-b bg-muted/30 px-3 py-3">
								<dl class="grid gap-x-4 gap-y-3 sm:grid-cols-[minmax(10rem,16rem)_minmax(0,1fr)]">
									{#each result.columns as column, index (`${column.name}:${index}`)}
										<dt class="min-w-0 text-xs text-muted-foreground">
											<span class="block truncate font-medium text-foreground">{column.name}</span>
											<span class="font-mono text-[10px]">{column.type}</span>
										</dt>
										<dd class="min-w-0">
											<pre
												class="max-h-64 min-h-9 overflow-auto rounded-sm border bg-background/60 p-2 font-mono text-xs wrap-break-word whitespace-pre-wrap">{formatDetailCell(
													row.original[index]
												)}</pre>
										</dd>
									{/each}
								</dl>
							</td>
						{/if}
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
</div>
