<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CloudCogIcon from '@lucide/svelte/icons/cloud-cog';
	import CompassIcon from '@lucide/svelte/icons/compass';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import ServerIcon from '@lucide/svelte/icons/server';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import { onMount } from 'svelte';

	import { getPersistedActiveClusterId } from '$lib/cluster/active-cluster-preference';
	import { createClusterConnectionStore } from '$lib/cluster/cluster-connection-store.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';

	const clusterConnectionStore = createClusterConnectionStore();
	const initialClusterId = clusterConnectionStore.clusters[0].id;
	const clusters = $derived(clusterConnectionStore.clusters);
	let activeClusterId = $state(initialClusterId);
	const activeCluster = $derived(
		clusters.find((cluster) => cluster.id === activeClusterId) ?? clusters[0]
	);

	onMount(() => {
		clusterConnectionStore.hydrate();
		const persistedClusterId = getPersistedActiveClusterId();
		if (clusters.some((cluster) => cluster.id === persistedClusterId)) {
			activeClusterId = persistedClusterId!;
		}
	});
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

		<section class="py-14 sm:py-20 lg:py-[clamp(3rem,8dvh,6rem)]">
			<div
				class="grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:gap-16"
			>
				<div class="max-w-3xl">
					<Badge variant="secondary">Alpha</Badge>
					<h1 class="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
						Explore data and operate your local Kusto clusters.
					</h1>
					<p class="text-muted-foreground mt-5 max-w-2xl text-base leading-7 sm:text-lg">
						Kite brings query authoring, schema exploration, and cluster administration into a
						focused workspace.
					</p>
					<div class="mt-7 flex flex-wrap gap-2">
						<Button href="/explorer/query" size="lg">
							Open Query Explorer
							<ArrowRightIcon />
						</Button>
						<Button href="/admin/commands" size="lg" variant="outline"
							>Open Management Console</Button
						>
					</div>
				</div>

				<Card.Root class="bg-card/70">
					<Card.Header class="gap-3">
						<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-2 text-sm font-medium">
								{#if activeCluster.kind === 'mock'}
									<FlaskConicalIcon class="size-4 text-primary" />
								{:else if activeCluster.kind === 'emulated'}
									<CpuIcon class="size-4 text-primary" />
								{:else if activeCluster.kind === 'log-analytics'}
									<CloudCogIcon class="size-4 text-primary" />
								{:else}
									<ServerIcon class="size-4 text-primary" />
								{/if}
								Current cluster
							</div>
							<Badge variant="outline">
								{activeCluster.kind === 'mock'
									? 'Mock catalog'
									: activeCluster.kind === 'emulated'
										? 'Browser emulation'
										: 'Configured connection'}
							</Badge>
						</div>
						<div class="min-w-0">
							<Card.Title class="truncate text-xl" title={activeCluster.name}
								>{activeCluster.name}</Card.Title
							>
							<Card.Description class="mt-1 line-clamp-2">
								{activeCluster.description ?? activeCluster.url}
							</Card.Description>
						</div>
					</Card.Header>
					<Card.Content class="pt-0">
						<p class="text-muted-foreground border-t pt-4 text-sm leading-6">
							This selection is shared by Explorer and Admin, and is restored when you return.
						</p>
					</Card.Content>
					<Card.Footer class="justify-end">
						<Button href="/explorer" variant="ghost" size="sm">
							Continue with this cluster
							<ArrowRightIcon />
						</Button>
					</Card.Footer>
				</Card.Root>
			</div>

			<div class="mt-12 grid gap-3 sm:grid-cols-2">
				<a href="/explorer" class="group min-w-0">
					<Card.Root class="h-full transition-colors group-hover:bg-accent/50">
						<Card.Header class="grid-cols-[auto_1fr_auto] gap-x-3">
							<DatabaseIcon class="row-span-2 mt-0.5 size-5 text-primary" />
							<Card.Title>Continue exploring</Card.Title>
							<ArrowRightIcon class="row-span-2 mt-0.5 size-4 text-muted-foreground" />
							<Card.Description
								>Browse schemas, write KQL, and revisit saved queries.</Card.Description
							>
						</Card.Header>
					</Card.Root>
				</a>

				<a href="/admin" class="group min-w-0">
					<Card.Root class="h-full transition-colors group-hover:bg-accent/50">
						<Card.Header class="grid-cols-[auto_1fr_auto] gap-x-3">
							<ShieldCheckIcon class="row-span-2 mt-0.5 size-5 text-muted-foreground" />
							<Card.Title>Manage your cluster</Card.Title>
							<ArrowRightIcon class="row-span-2 mt-0.5 size-4 text-muted-foreground" />
							<Card.Description
								>Inspect databases and work with cluster administration tools.</Card.Description
							>
						</Card.Header>
					</Card.Root>
				</a>
			</div>
		</section>

		<footer class="text-muted-foreground mt-auto flex items-center gap-1 py-2 text-xs">
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
