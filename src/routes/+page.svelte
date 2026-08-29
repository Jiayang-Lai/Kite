<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CompassIcon from '@lucide/svelte/icons/compass';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import FileCode2Icon from '@lucide/svelte/icons/file-code-2';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';

	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
</script>

<svelte:head><title>Kite</title></svelte:head>

<main class="min-h-dvh bg-muted/30 px-4 py-4 sm:px-6 sm:py-6">
	<div
		class="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-6xl flex-col sm:min-h-[calc(100dvh-3rem)]"
	>
		<header class="flex items-center gap-2 text-sm font-semibold tracking-tight">
			<div class="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
				<CompassIcon class="size-4" />
			</div>
			Kite
		</header>

		<section class="flex flex-1 flex-col justify-center py-14 sm:py-20">
			<div class="max-w-4xl">
				<Badge variant="secondary">Alpha</Badge>
				<h1 class="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
					Explore data and operate Kusto from one focused workspace.
				</h1>
				<p class="text-muted-foreground mt-5 max-w-2xl text-base leading-7 sm:text-lg">
					Write KQL, discover schemas, and manage supported clusters without leaving the browser.
				</p>
				<div class="mt-7 flex flex-wrap gap-2">
					<Button href="/explorer" size="lg">
						Open Explorer
						<ArrowRightIcon data-icon="inline-end" />
					</Button>
					<Button href="/admin" size="lg" variant="outline">Open Administration</Button>
				</div>
			</div>

			<div class="mt-14 grid gap-8 border-t pt-8 sm:grid-cols-3">
				<div class="flex gap-3">
					<FileCode2Icon class="mt-0.5 size-5 shrink-0 text-primary" />
					<div>
						<h2 class="text-sm font-medium">Query</h2>
						<p class="text-muted-foreground mt-1 text-sm leading-6">
							Compose KQL with schema-aware editing and inspect results in place.
						</p>
					</div>
				</div>

				<div class="flex gap-3">
					<DatabaseIcon class="mt-0.5 size-5 shrink-0 text-primary" />
					<div>
						<h2 class="text-sm font-medium">Discover</h2>
						<p class="text-muted-foreground mt-1 text-sm leading-6">
							Search databases, tables, functions, and locally saved queries.
						</p>
					</div>
				</div>

				<div class="flex gap-3">
					<ShieldCheckIcon class="mt-0.5 size-5 shrink-0 text-primary" />
					<div>
						<h2 class="text-sm font-medium">Operate</h2>
						<p class="text-muted-foreground mt-1 text-sm leading-6">
							Review capabilities before managing schemas, commands, and ingestion.
						</p>
					</div>
				</div>
			</div>
		</section>

		<footer class="text-muted-foreground flex items-center gap-1 py-2 text-xs">
			<span>Made with</span>
			<HeartIcon class="size-3.5 fill-primary text-primary" aria-label="love" />
			<span>by</span>
			<a
				href="https://github.com/Jiayang-Lai"
				target="_blank"
				rel="noreferrer"
				class="hover:text-foreground underline-offset-4 hover:underline">Jiayang</a
			>
		</footer>
	</div>
</main>
