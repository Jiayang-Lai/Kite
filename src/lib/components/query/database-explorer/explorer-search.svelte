<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';

	import * as Sidebar from '$lib/components/ui/sidebar';

	type ExplorerSearchProps = {
		value?: string;
		disabled?: boolean;
	};

	let { value = $bindable(''), disabled = false }: ExplorerSearchProps = $props();
</script>

<div class="relative group-data-[collapsible=icon]:hidden">
	<SearchIcon
		class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
	/>
	<Sidebar.Input
		bind:value
		class="h-8 bg-background/70 pr-2 pl-8 text-xs"
		placeholder="Search"
		aria-label="Search databases, tables, functions, saved queries, and recent queries"
		{disabled}
	/>
</div>
