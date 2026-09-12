<script lang="ts">
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import BookmarkPlusIcon from '@lucide/svelte/icons/bookmark-plus';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import PanelRightCloseIcon from '@lucide/svelte/icons/panel-right-close';
	import PanelRightOpenIcon from '@lucide/svelte/icons/panel-right-open';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';

	import type { QueryTab } from '$lib/cluster/cluster-session.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { cn } from '$lib/utils';

	type QueryTabBarProps = {
		tabs: QueryTab[];
		activeTab?: QueryTab;
		originalTab?: QueryTab;
		modifiedTab?: QueryTab;
		compareCandidates: QueryTab[];
		schemaCollapsed: boolean;
		canSave: boolean;
		saveTitle: string;
		isRunning: boolean;
		canRun: boolean;
		runTitle: string;
		titleFor: (tab: QueryTab) => string;
		isDirty: (tab: QueryTab) => boolean;
		onselect: (tab: QueryTab) => void;
		oncompare: (tab: QueryTab) => void;
		onclose: (tab: QueryTab) => void;
		oncreate: () => void;
		ontogglecomparison: () => void;
		ontoggleschema: () => void;
		onsave: () => void;
		onrun: () => void;
		oncancel: () => void;
	};

	let {
		tabs,
		activeTab,
		originalTab,
		modifiedTab,
		compareCandidates,
		schemaCollapsed,
		canSave,
		saveTitle,
		isRunning,
		canRun,
		runTitle,
		titleFor,
		isDirty,
		onselect,
		oncompare,
		onclose,
		oncreate,
		ontogglecomparison,
		ontoggleschema,
		onsave,
		onrun,
		oncancel
	}: QueryTabBarProps = $props();

	let tabList = $state<HTMLDivElement>();
	let canScrollLeft = $state(false);
	let canScrollRight = $state(false);
	let dragPointerId = $state<number>();
	let dragStartX = 0;
	let dragStartScrollLeft = 0;
	let ignoreClick = false;

	$effect(() => {
		const tabCount = tabs.length;
		const list = tabList;
		if (!list) return;
		void tabCount;

		const updateOverflow = () => {
			canScrollLeft = list.scrollLeft > 0;
			canScrollRight = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
		};
		const resizeObserver = new ResizeObserver(updateOverflow);
		resizeObserver.observe(list);
		list.addEventListener('scroll', updateOverflow);
		updateOverflow();

		return () => {
			resizeObserver.disconnect();
			list.removeEventListener('scroll', updateOverflow);
		};
	});

	$effect(() => {
		const activeTabId = activeTab?.id;
		if (!activeTabId) return;
		requestAnimationFrame(() => {
			tabList
				?.querySelector<HTMLElement>(`[data-query-tab-id="${activeTabId}"]`)
				?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
		});
	});

	function scrollWithWheel(event: WheelEvent) {
		if (!tabList || tabList.scrollWidth <= tabList.clientWidth) return;
		const distance = event.deltaX || event.deltaY;
		if (!distance) return;
		event.preventDefault();
		tabList.scrollBy({ left: distance });
	}

	function scroll(direction: 'left' | 'right') {
		if (!tabList) return;
		tabList.scrollBy({
			left: tabList.clientWidth * 0.65 * (direction === 'left' ? -1 : 1),
			behavior: 'smooth'
		});
	}

	function startDrag(event: PointerEvent) {
		if (event.button !== 0 || !tabList || tabList.scrollWidth <= tabList.clientWidth) return;
		dragPointerId = event.pointerId;
		dragStartX = event.clientX;
		dragStartScrollLeft = tabList.scrollLeft;
		tabList.setPointerCapture(event.pointerId);
	}

	function drag(event: PointerEvent) {
		if (event.pointerId !== dragPointerId || !tabList) return;
		const distance = event.clientX - dragStartX;
		if (Math.abs(distance) > 3) ignoreClick = true;
		tabList.scrollLeft = dragStartScrollLeft - distance;
	}

	function stopDrag(event: PointerEvent) {
		if (event.pointerId !== dragPointerId || !tabList) return;
		tabList.releasePointerCapture(event.pointerId);
		dragPointerId = undefined;
		if (ignoreClick) window.setTimeout(() => (ignoreClick = false));
	}
</script>

<div class="flex h-9 shrink-0 items-stretch border-b bg-card">
	<div class="relative min-w-0 flex-1">
		<div
			bind:this={tabList}
			class:cursor-grabbing={dragPointerId !== undefined}
			class="flex h-full min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			role="tablist"
			aria-label="Query tabs"
			tabindex="0"
			onwheel={scrollWithWheel}
			onpointerdown={startDrag}
			onpointermove={drag}
			onpointerup={stopDrag}
			onpointercancel={stopDrag}
		>
			{#each tabs as tab (tab.id)}
				{@const isOriginal = originalTab?.id === tab.id}
				{@const isModified = Boolean(originalTab && modifiedTab?.id === tab.id)}
				{@const isLocked = Boolean(
					originalTab && modifiedTab && tab.id !== originalTab.id && tab.id !== modifiedTab.id
				)}
				<div
					data-query-tab-id={tab.id}
					class={cn(
						'group flex h-full min-w-0 shrink-0 items-center border-r border-t-2 border-t-transparent px-2 text-xs transition-colors',
						tab.id === activeTab?.id
							? 'border-t-primary bg-primary/10 text-foreground'
							: isModified
								? 'border-t-primary/70 bg-primary/10 text-foreground'
								: isOriginal
									? 'border-t-amber-500/70 bg-amber-500/10 text-foreground'
									: isLocked
										? 'cursor-not-allowed text-muted-foreground opacity-50'
										: 'text-muted-foreground hover:bg-muted'
					)}
					role="tab"
					aria-selected={tab.id === activeTab?.id}
					aria-disabled={isLocked}
					aria-label={`${titleFor(tab)}${isOriginal ? ', comparison original' : isModified ? ', comparison modified' : ''}`}
				>
					<button
						type="button"
						class="flex h-full max-w-32 min-w-0 items-center text-left outline-none"
						disabled={isLocked}
						onclick={(event) => {
							if (ignoreClick) return;
							if (event.shiftKey) oncompare(tab);
							else onselect(tab);
						}}
						title={isLocked
							? 'Close diff to select this query'
							: `${titleFor(tab)}${
									activeTab &&
									tab.id !== activeTab.id &&
									tab.database.trim().toLowerCase() === activeTab.database.trim().toLowerCase()
										? ' (Shift-click to compare)'
										: ''
								}`}
					>
						{#if isDirty(tab)}
							<span
								class="bg-primary mr-1 inline-block size-1.5 shrink-0 rounded-full"
								aria-hidden="true"
							></span>
							<span class="sr-only">Unsaved changes </span>
						{/if}
						<span class="min-w-0 truncate">{titleFor(tab)}</span>
					</button>
					<Button
						variant="ghost"
						size="icon-xs"
						class="-mr-1 size-6 rounded-none opacity-60 group-hover:opacity-100"
						aria-label={`Close ${titleFor(tab)}`}
						onpointerdown={(event) => event.stopPropagation()}
						onclick={(event) => {
							event.stopPropagation();
							onclose(tab);
						}}
					>
						<XIcon />
					</Button>
				</div>
			{/each}
		</div>
		{#if canScrollLeft}
			<Button
				variant="ghost"
				size="icon-sm"
				class="absolute inset-y-0 left-0 z-10 h-full w-8 rounded-none border-0 border-r bg-card"
				aria-label="Show earlier query tabs"
				title="Show earlier query tabs"
				onpointerdown={(event) => event.stopPropagation()}
				onclick={() => scroll('left')}
			>
				<ChevronLeftIcon />
			</Button>
		{/if}
		{#if canScrollRight}
			<Button
				variant="ghost"
				size="icon-sm"
				class="absolute inset-y-0 right-0 z-10 h-full w-8 rounded-none border-0 border-l bg-card"
				aria-label="Show later query tabs"
				title="Show later query tabs"
				onpointerdown={(event) => event.stopPropagation()}
				onclick={() => scroll('right')}
			>
				<ChevronRightIcon />
			</Button>
		{/if}
	</div>

	<div class="flex shrink-0 items-stretch border-l bg-card">
		<Button
			variant="ghost"
			size="icon-sm"
			class="h-full w-9 rounded-none border-0 border-r"
			aria-label="New query tab"
			onclick={oncreate}
		>
			<PlusIcon />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			class="h-full w-9 rounded-none border-0 border-r"
			aria-label={schemaCollapsed ? 'Show database schema' : 'Hide database schema'}
			title={schemaCollapsed ? 'Show database schema' : 'Hide database schema'}
			onclick={ontoggleschema}
		>
			{#if schemaCollapsed}<PanelRightOpenIcon />{:else}<PanelRightCloseIcon />{/if}
		</Button>
		<Button
			variant="outline"
			size="sm"
			class="h-full rounded-none border-0 border-r px-2.5 shadow-none"
			disabled={!originalTab && !compareCandidates.length}
			onclick={ontogglecomparison}
			title={originalTab
				? 'Close query comparison'
				: compareCandidates.length
					? 'Compare with another query in this database'
					: 'Open another query tab for this database to compare queries'}
		>
			<ArrowLeftRightIcon />
			{originalTab ? 'Close diff' : 'Compare'}
		</Button>
		<Button
			variant="outline"
			size="sm"
			class="h-full rounded-none border-0 border-r px-2.5 shadow-none"
			disabled={!canSave}
			onclick={onsave}
			title={saveTitle}
		>
			<BookmarkPlusIcon />
			Save
		</Button>
		{#if isRunning}
			<Button
				variant="outline"
				size="sm"
				class="h-full rounded-none border-0 border-r px-2.5 shadow-none"
				onclick={oncancel}
			>
				<CircleStopIcon />
				Cancel
			</Button>
		{:else}
			<Separator orientation="vertical" />
			<Button
				size="sm"
				class="h-full rounded-none border-0 px-3 shadow-none"
				onclick={onrun}
				disabled={!canRun}
				title={runTitle}
				aria-keyshortcuts={canRun ? 'Shift+Enter' : undefined}
			>
				<PlayIcon />
				Run
			</Button>
		{/if}
	</div>
</div>
