<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import DatabaseZapIcon from '@lucide/svelte/icons/database-zap';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import UploadIcon from '@lucide/svelte/icons/upload';

	import EmulatedStorageBadge from '$lib/components/cluster/emulated-storage-badge.svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import type { ConnectionCapabilities } from '$lib/cluster/connection-capabilities';
	import type { EmulatedStorage } from '$lib/emulation/storage';

	type AdminHeroProps = {
		clusterName: string;
		databaseCount: number;
		tableCount: number;
		connectionStatus: 'loading' | 'ready' | 'error';
		connectionError?: string;
		capabilities: ConnectionCapabilities;
		emulatedStorage?: EmulatedStorage;
	};

	let {
		clusterName,
		databaseCount,
		tableCount,
		connectionStatus,
		connectionError,
		capabilities,
		emulatedStorage
	}: AdminHeroProps = $props();

	const schemaAdministration = $derived(
		capabilities.databases.create || capabilities.databases.drop || capabilities.databases.rename
			? 'Available'
			: 'Read only'
	);
	const queryExecution = $derived(
		capabilities.queryExecutor === 'none' ? 'Unavailable' : 'Available'
	);
	const ingestion = $derived(
		capabilities.ingestion === 'none'
			? 'Unavailable'
			: capabilities.ingestion === 'emulated'
				? 'Browser emulation'
				: 'Kustainer'
	);
	const primaryAction = $derived(
		capabilities.managementCommands
			? { href: '/admin/commands', label: 'Run a management command' }
			: capabilities.ingestion !== 'none'
				? { href: '/admin/ingestion', label: 'Ingest data' }
				: { href: '/admin/databases', label: 'Inspect schema' }
	);
</script>

<section class="min-h-0 flex-1 overflow-auto">
	<div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
		<header class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div class="min-w-0 max-w-3xl">
				<div class="flex flex-wrap items-center gap-2">
					<Badge variant="secondary">
						<DatabaseZapIcon />
						Operations
					</Badge>
					{#if emulatedStorage}
						<EmulatedStorageBadge storage={emulatedStorage} />
					{/if}
				</div>
				<h1 class="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
					Operate <span class="text-primary">{clusterName}</span>
				</h1>
				<p class="text-muted-foreground mt-2 max-w-2xl text-sm leading-6 sm:text-base">
					Review connection health and available administrative capabilities before making changes.
				</p>
			</div>
			<Button href={primaryAction.href}>{primaryAction.label}</Button>
		</header>

		{#if connectionStatus === 'error'}
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Cluster connection needs attention</Alert.Title>
				<Alert.Description>
					{connectionError || 'Kite could not load the current cluster schema.'}
				</Alert.Description>
			</Alert.Root>
		{:else if connectionStatus === 'loading'}
			<Alert.Root>
				<LoaderCircleIcon class="animate-spin" />
				<Alert.Title>Loading cluster state</Alert.Title>
				<Alert.Description>
					Administrative capabilities will be ready after the schema finishes loading.
				</Alert.Description>
			</Alert.Root>
		{:else if capabilities.queryExecutor === 'none' || capabilities.ingestion === 'none'}
			<Alert.Root>
				<CircleAlertIcon />
				<Alert.Title>Some operations are unavailable</Alert.Title>
				<Alert.Description>
					This connection exposes only the capabilities listed below. Unavailable actions remain
					hidden or disabled in their workspaces.
				</Alert.Description>
			</Alert.Root>
		{/if}

		<div class="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
			<Card.Root>
				<Card.Header>
					<Card.Title>Cluster status</Card.Title>
					<Card.Description>Current connection and catalog inventory.</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-col gap-4">
					<div class="flex items-center justify-between gap-3">
						<span class="text-muted-foreground text-sm">Connection</span>
						<Badge variant={connectionStatus === 'error' ? 'destructive' : 'secondary'}>
							{#if connectionStatus === 'ready'}
								<CircleCheckIcon /> Ready
							{:else if connectionStatus === 'loading'}
								<LoaderCircleIcon class="animate-spin" /> Loading
							{:else}
								<CircleAlertIcon /> Error
							{/if}
						</Badge>
					</div>
					<div class="flex items-center justify-between gap-3">
						<span class="text-muted-foreground text-sm">Databases</span>
						<span class="text-sm font-medium">{databaseCount}</span>
					</div>
					<div class="flex items-center justify-between gap-3">
						<span class="text-muted-foreground text-sm">Tables</span>
						<span class="text-sm font-medium">{tableCount}</span>
					</div>
				</Card.Content>
				<Card.Footer>
					<Button href="/admin/databases" variant="outline" size="sm">Inspect catalog</Button>
				</Card.Footer>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title>Capabilities</Card.Title>
					<Card.Description>Operations supported by this connection type.</Card.Description>
				</Card.Header>
				<Card.Content class="grid gap-3 sm:grid-cols-2">
					<div class="flex items-center justify-between gap-3 rounded-lg border p-3">
						<span class="text-sm">Query execution</span>
						<Badge variant="outline">{queryExecution}</Badge>
					</div>
					<div class="flex items-center justify-between gap-3 rounded-lg border p-3">
						<span class="text-sm">Schema administration</span>
						<Badge variant="outline">{schemaAdministration}</Badge>
					</div>
					<div class="flex items-center justify-between gap-3 rounded-lg border p-3">
						<span class="text-sm">Management commands</span>
						<Badge variant="outline">
							{capabilities.managementCommands ? 'Available' : 'Unavailable'}
						</Badge>
					</div>
					<div class="flex items-center justify-between gap-3 rounded-lg border p-3">
						<span class="text-sm">Data ingestion</span>
						<Badge variant="outline">{ingestion}</Badge>
					</div>
				</Card.Content>
			</Card.Root>
		</div>

		<Card.Root>
			<Card.Header>
				<Card.Title>Available administration</Card.Title>
				<Card.Description>
					Actions are shown according to the selected connection's capabilities.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-wrap gap-2">
				<Button href="/admin/databases" variant="outline">
					<DatabaseIcon data-icon="inline-start" />
					Databases &amp; tables
				</Button>
				{#if capabilities.managementCommands}
					<Button href="/admin/commands" variant="outline">
						<SquareTerminalIcon data-icon="inline-start" />
						Management commands
					</Button>
				{/if}
				{#if capabilities.ingestion !== 'none'}
					<Button href="/admin/ingestion" variant="outline">
						<UploadIcon data-icon="inline-start" />
						Data ingestion
					</Button>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</section>
