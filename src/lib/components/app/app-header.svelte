<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';

	import { Badge } from '$lib/components/ui/badge';
	import * as Sidebar from '$lib/components/ui/sidebar';

	type BreadcrumbItem = {
		label: string;
		href?: string;
	};

	type AppHeaderProps = {
		breadcrumbs: BreadcrumbItem[];
		title: string;
		badge?: string;
		sidebarToggleLabel: string;
		children?: Snippet;
	};

	let { breadcrumbs, title, badge, sidebarToggleLabel, children }: AppHeaderProps = $props();
</script>

<header
	class="flex shrink-0 flex-col gap-2 rounded-xl border bg-background p-2 shadow-xs sm:p-3 md:flex-row md:items-center md:justify-between"
>
	<div class="min-w-0">
		<div class="flex min-w-0 items-center gap-2">
			<Sidebar.Trigger
				class="shrink-0"
				title={sidebarToggleLabel}
				aria-label={sidebarToggleLabel}
			/>
			<nav class="min-w-0" aria-label="Breadcrumb">
				<ol class="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
					{#each breadcrumbs as item, index (item.label)}
						{#if index > 0}
							<ChevronRightIcon class="size-3 shrink-0" aria-hidden="true" />
						{/if}
						<li class="min-w-0 truncate">
							{#if item.href}
								<a class="hover:text-foreground hover:underline" href={item.href}>{item.label}</a>
							{:else}
								<span aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}
									>{item.label}</span
								>
							{/if}
						</li>
					{/each}
				</ol>
			</nav>
		</div>

		{#if title || badge}
			<div class="mt-1 flex flex-wrap items-center gap-2">
				{#if title}<h1 class="text-lg font-semibold tracking-tight">{title}</h1>{/if}
				{#if badge}<Badge variant="outline">{badge}</Badge>{/if}
			</div>
		{/if}
		{@render children?.()}
	</div>
</header>
