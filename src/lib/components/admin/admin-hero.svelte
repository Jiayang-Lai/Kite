<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import DatabaseZapIcon from '@lucide/svelte/icons/database-zap';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import UploadIcon from '@lucide/svelte/icons/upload';

	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';

	type AdminHeroProps = {
		clusterName: string;
		databaseCount: number;
		tableCount: number;
	};

	let { clusterName, databaseCount, tableCount }: AdminHeroProps = $props();
</script>

<section class="min-h-0 flex-1 overflow-auto">
	<div class="mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center py-8 sm:py-12">
		<div class="max-w-2xl">
			<Badge variant="secondary">
				<DatabaseZapIcon />
				Cluster administration
			</Badge>
			<h1 class="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
				Manage <span class="text-primary">{clusterName}</span> with confidence.
			</h1>
			<p class="text-muted-foreground mt-3 text-base leading-7">
				Browse cluster schema, run management commands, and ingest local Kustainer data from one
				workspace.
			</p>
			<div class="text-muted-foreground mt-5 flex flex-wrap items-center gap-2 text-sm">
				<Badge variant="outline"
					>{databaseCount} {databaseCount === 1 ? 'database' : 'databases'}</Badge
				>
				<Badge variant="outline">{tableCount} {tableCount === 1 ? 'table' : 'tables'}</Badge>
			</div>
		</div>

		<div class="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			<a href="/admin/databases" class="group min-w-0">
				<Card.Root class="h-full transition-colors group-hover:bg-accent/50">
					<Card.Header class="grid-cols-[auto_1fr_auto] gap-x-3">
						<DatabaseIcon class="row-span-2 mt-0.5 size-5 text-primary" />
						<Card.Title>Databases &amp; tables</Card.Title>
						<ArrowRightIcon class="row-span-2 mt-0.5 size-4 text-muted-foreground" />
						<Card.Description>Browse schemas, tables, columns, and functions.</Card.Description>
					</Card.Header>
				</Card.Root>
			</a>

			<a href="/admin/commands" class="group min-w-0">
				<Card.Root class="h-full transition-colors group-hover:bg-accent/50">
					<Card.Header class="grid-cols-[auto_1fr_auto] gap-x-3">
						<SquareTerminalIcon class="row-span-2 mt-0.5 size-5 text-muted-foreground" />
						<Card.Title>Commands</Card.Title>
						<ArrowRightIcon class="row-span-2 mt-0.5 size-4 text-muted-foreground" />
						<Card.Description>Run and inspect administrative Kusto commands.</Card.Description>
					</Card.Header>
				</Card.Root>
			</a>

			<a href="/admin/ingestion" class="group min-w-0">
				<Card.Root class="h-full transition-colors group-hover:bg-accent/50">
					<Card.Header class="grid-cols-[auto_1fr_auto] gap-x-3">
						<UploadIcon class="row-span-2 mt-0.5 size-5 text-muted-foreground" />
						<Card.Title>Data ingestion</Card.Title>
						<ArrowRightIcon class="row-span-2 mt-0.5 size-4 text-muted-foreground" />
						<Card.Description>Append pasted, browser-selected, or mounted data.</Card.Description>
					</Card.Header>
				</Card.Root>
			</a>
		</div>
	</div>
</section>
