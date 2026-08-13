<script lang="ts">
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import SquareFunctionIcon from '@lucide/svelte/icons/square-function';
	import TablePropertiesIcon from '@lucide/svelte/icons/table-properties';
	import { tick } from 'svelte';
	import { get } from 'svelte/store';

	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { cn } from '$lib/utils';

	type SchemaObject = {
		name: string;
	};

	type VirtualizedSchemaObjectListProps = {
		items: readonly SchemaObject[];
		kind: 'table' | 'function';
		selectedName?: string;
		onselect: (name: string) => void;
	};

	let { items, kind, selectedName, onselect }: VirtualizedSchemaObjectListProps = $props();

	const MAX_VISIBLE_ITEMS = 12;
	const ITEM_SIZE = 32;
	let scrollElement = $state<HTMLElement | null>(null);
	const virtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
		count: 0,
		getScrollElement: () => null,
		estimateSize: () => ITEM_SIZE,
		getItemKey: (index) => String(index),
		overscan: 8
	});

	$effect(() => {
		get(virtualizer).setOptions({
			count: items.length,
			getScrollElement: () => scrollElement,
			getItemKey: (index) => items[index]?.name ?? String(index)
		});
	});

	$effect(() => {
		items;
		void tick().then(() => get(virtualizer).measure());
	});

	function measureItem(node: HTMLDivElement) {
		get(virtualizer).measureElement(node);
	}
</script>

<ScrollArea
	class={items.length > MAX_VISIBLE_ITEMS ? 'h-72' : ''}
	orientation="vertical"
	bind:viewportRef={scrollElement}
>
	{#if items.length}
		<div class="relative" style:height={`${$virtualizer.getTotalSize()}px`}>
			<Sidebar.MenuSub class="absolute inset-0 mx-0 translate-x-0 border-s-0 border-l-0 px-0.5">
				{#each $virtualizer.getVirtualItems() as virtualItem (virtualItem.key)}
					{@const item = items[virtualItem.index]}
					{#if item}
						{@const selected = selectedName === item.name}
						<Sidebar.MenuSubItem
							class="absolute top-0 left-0 w-full"
							style={`transform: translateY(${virtualItem.start}px)`}
						>
							<div use:measureItem data-index={virtualItem.index} class="pb-1">
								<button
									type="button"
									class={cn(
										'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs outline-none focus-visible:ring-2',
										selected && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
									)}
									onclick={() => onselect(item.name)}
									aria-pressed={selected}
								>
									{#if kind === 'table'}
										<TablePropertiesIcon class="text-muted-foreground size-3.5 shrink-0" />
									{:else}
										<SquareFunctionIcon class="text-muted-foreground size-3.5 shrink-0" />
									{/if}
									<span class="min-w-0 flex-1 truncate font-mono" title={item.name}>{item.name}</span>
								</button>
							</div>
						</Sidebar.MenuSubItem>
					{/if}
				{/each}
			</Sidebar.MenuSub>
		</div>
	{:else}
		<p class="text-muted-foreground px-2 py-2 text-xs">
			No {kind === 'table' ? 'tables' : 'functions'} found.
		</p>
	{/if}
</ScrollArea>
