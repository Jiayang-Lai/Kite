<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Spinner } from '$lib/components/ui/spinner';
	import {
		buildDropColumnPlan,
		buildRenameColumnPlan,
		type TableMutationPlan,
		type TableSchemaSnapshot
	} from '$lib/kusto/table-management';
	import type { KustoColumn, KustoTable } from '$lib/types/kusto-schema';

	export type ColumnMutationAction = 'rename' | 'drop';

	type ColumnMutationDialogProps = {
		open?: boolean;
		action: ColumnMutationAction;
		table: KustoTable;
		column: KustoColumn;
		databaseName: string;
		clusterName: string;
		isPreparing?: boolean;
		isRunning?: boolean;
		preflightReady?: boolean;
		snapshot?: TableSchemaSnapshot;
		executionError?: string;
		onsubmit?: (plan: TableMutationPlan) => void;
		oncancel?: () => void;
	};

	let {
		open = $bindable(false),
		action,
		table,
		column,
		databaseName,
		clusterName,
		isPreparing = false,
		isRunning = false,
		preflightReady = false,
		snapshot,
		executionError = '',
		onsubmit,
		oncancel
	}: ColumnMutationDialogProps = $props();

	let initializedTarget = '';
	let newColumnName = $state('');
	let confirmationText = $state('');
	let dialogContent = $state<HTMLElement | null>(null);
	const isBusy = $derived(isPreparing || isRunning);
	const confirmationPhrase = $derived(
		action === 'rename' ? 'RENAME' : `${table.name}.${column.name}`
	);

	const preparedPlan = $derived.by(() => {
		try {
			const existingColumnNames = table.columns.map((item) => item.name);
			const plan =
				action === 'rename'
					? buildRenameColumnPlan({
							tableName: table.name,
							columnName: column.name,
							newColumnName,
							existingColumnNames
						})
					: buildDropColumnPlan({
							tableName: table.name,
							columnName: column.name,
							existingColumnNames
						});
			return { plan, error: '' };
		} catch (error) {
			return {
				plan: undefined,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	});

	$effect(() => {
		const target = open
			? `${databaseName}\u0000${table.name}\u0000${column.name}\u0000${action}`
			: '';
		if (!target || target === initializedTarget) return;
		initializedTarget = target;
		newColumnName = '';
		confirmationText = '';
	});

	$effect(() => {
		if (!open) initializedTarget = '';
	});

	function submitMutation() {
		if (
			!preparedPlan.plan ||
			!preflightReady ||
			confirmationText !== confirmationPhrase ||
			isBusy
		) {
			return;
		}
		onsubmit?.(preparedPlan.plan);
	}

	function focusDialogWithoutScrolling(event: Event) {
		event.preventDefault();
		dialogContent?.focus({ preventScroll: true });
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		bind:ref={dialogContent}
		class="grid h-[min(90dvh,42rem)] w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden sm:max-w-xl"
		showCloseButton={!isBusy}
		aria-describedby="column-mutation-description"
		tabindex={-1}
		onOpenAutoFocus={focusDialogWithoutScrolling}
	>
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title>
				{action === 'rename' ? `Rename ${column.name}` : `Remove ${column.name}`}
			</Dialog.Title>
			<Dialog.Description id="column-mutation-description">
				{action === 'rename'
					? 'Change this column name without converting or replacing its stored values.'
					: 'Permanently remove this column and all values stored in it.'}
			</Dialog.Description>
		</Dialog.Header>

		<ScrollArea
			class="h-full min-h-0 overflow-hidden overscroll-contain"
			orientation="vertical"
			type="auto"
			scrollbarYClasses="py-1"
		>
			<div class="space-y-5 p-4 pr-5">
				<dl class="divide-y rounded-lg border text-sm">
					<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
						<dt class="text-muted-foreground">Cluster</dt>
						<dd class="break-words font-medium">{clusterName}</dd>
					</div>
					<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
						<dt class="text-muted-foreground">Target</dt>
						<dd class="break-all font-mono">{databaseName} / {table.name}.{column.name}</dd>
					</div>
					<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
						<dt class="text-muted-foreground">Type</dt>
						<dd><Badge variant="outline" class="font-mono">{column.type}</Badge></dd>
					</div>
					<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
						<dt class="text-muted-foreground">Risk</dt>
						<dd>
							<Badge variant="destructive">
								{action === 'rename' ? 'Breaking change' : 'Irreversible'}
							</Badge>
						</dd>
					</div>
					{#if snapshot}
						<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
							<dt class="text-muted-foreground">Verified</dt>
							<dd class="min-w-0">
								<p>Current schema checked</p>
								{#if snapshot.tableId}
									<p class="text-muted-foreground mt-1 truncate font-mono text-[11px]">
										Table ID: {snapshot.tableId}
									</p>
								{/if}
								{#if snapshot.totalRowCount != null}
									<p class="text-muted-foreground mt-1 text-[11px]">
										{snapshot.totalRowCount.toLocaleString()}
										{snapshot.totalRowCount === 1 ? 'row' : 'rows'}
									</p>
								{/if}
							</dd>
						</div>
					{/if}
				</dl>

				<div
					class="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs"
					aria-live="polite"
				>
					{#if isPreparing}
						<Spinner />
						<span>Checking the current schema and table identity…</span>
					{:else if preflightReady}
						<Badge variant="outline">Verified</Badge>
						<span class="text-muted-foreground">
							The table will be checked again immediately before this command.
						</span>
					{:else}
						<CircleAlertIcon class="text-destructive size-4 shrink-0" />
						<span class="text-destructive">Schema verification is required before execution.</span>
					{/if}
				</div>

				{#if action === 'rename'}
					<div>
						<label class="text-sm font-medium" for="new-column-name">New column name</label>
						<Input
							id="new-column-name"
							class="mt-2 font-mono"
							bind:value={newColumnName}
							disabled={isBusy}
							autocomplete="off"
							placeholder="NewColumnName"
						/>
						{#if preparedPlan.error && newColumnName.trim()}
							<p class="text-destructive mt-1.5 text-xs">{preparedPlan.error}</p>
						{/if}
					</div>
				{/if}

				{#if preparedPlan.plan}
					<div>
						<h3 class="mb-2 text-sm font-medium">Management command</h3>
						<pre
							class="bg-muted max-h-36 overflow-auto rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">{preparedPlan
								.plan.command}</pre>
					</div>
				{/if}

				<div class="border-warning/40 bg-warning/10 rounded-lg border p-3">
					<div class="text-warning flex items-start gap-2">
						<CircleAlertIcon class="mt-0.5 size-4 shrink-0" />
						<div>
							<p class="text-sm font-medium">
								{action === 'rename'
									? 'Dependent references are not rewritten'
									: 'Deleted column data cannot be recovered'}
							</p>
							<p class="mt-1 text-xs leading-5">
								{action === 'rename'
									? 'Stored functions, ingestion mappings, policies, dashboards, and client queries may still reference the old name and can fail after this change.'
									: 'All values in this column become unqueryable. Adding a column with the same name later will not restore them.'}
							</p>
						</div>
					</div>
				</div>

				<div>
					<label class="text-sm font-medium" for="confirm-column-mutation">
						Type <span class="font-mono">{confirmationPhrase}</span> to confirm
					</label>
					<Input
						id="confirm-column-mutation"
						class="mt-2 font-mono"
						bind:value={confirmationText}
						disabled={isBusy}
						autocomplete="off"
					/>
				</div>

				{#if executionError}
					<p
						class="text-destructive bg-destructive/5 whitespace-pre-wrap rounded-lg border border-destructive/20 p-3 text-xs"
						role="alert"
					>
						{executionError}
					</p>
				{/if}
			</div>
		</ScrollArea>

		<Dialog.Footer class="border-t p-4">
			{#if isPreparing}
				<Button
					variant="outline"
					onclick={() => {
						oncancel?.();
						open = false;
					}}>Cancel</Button
				>
				<Button disabled><Spinner /> Checking current schema</Button>
			{:else if isRunning}
				<Button variant="outline" onclick={() => oncancel?.()}>
					<Spinner /> Stop waiting
				</Button>
				<Button disabled>
					<Spinner />
					{action === 'rename' ? 'Renaming column' : 'Removing column'}
				</Button>
			{:else}
				<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button
					variant={action === 'drop' ? 'destructive' : 'default'}
					disabled={!preparedPlan.plan ||
						!preflightReady ||
						confirmationText !== confirmationPhrase}
					onclick={submitMutation}
				>
					{#if action === 'rename'}<PencilIcon /> Rename column{:else}<Trash2Icon /> Remove column{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
