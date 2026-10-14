<script lang="ts">
	import BinaryIcon from '@lucide/svelte/icons/binary';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Select from '$lib/components/ui/select';
	import { Spinner } from '$lib/components/ui/spinner';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { ColumnMutationAction } from '$lib/admin/mutation-contracts';
	import { createReviewablePlan } from '$lib/admin/reviewable-plan.svelte';
	import {
		buildChangeColumnTypePlan,
		buildDropColumnPlan,
		buildEditColumnPlan,
		formatPlanCommands,
		KUSTO_SCALAR_TYPES,
		type KustoScalarType,
		type TableMutationPlan,
		type TableSchemaSnapshot
	} from '$lib/kusto/table-management';
	import type { KustoColumn, KustoTable } from '$lib/types/kusto-schema';

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
	let newColumnDocstring = $state('');
	let newColumnType = $state<KustoScalarType | ''>('');
	let dialogContent = $state<HTMLElement | null>(null);
	const isBusy = $derived(isPreparing || isRunning);
	const renames = $derived(action === 'edit' && newColumnName.trim() !== column.name);
	const editsSomething = $derived(
		renames || newColumnDocstring.trim() !== (column.docstring ?? '').trim()
	);

	const reviewPlan = createReviewablePlan(() => {
		const existingColumnNames = table.columns.map((item) => item.name);
		let plan: TableMutationPlan;
		if (action === 'edit') {
			plan = buildEditColumnPlan({
				tableName: table.name,
				columnName: column.name,
				currentDocstring: column.docstring,
				newColumnName,
				nextDocstring: newColumnDocstring,
				existingColumnNames
			});
		} else if (action === 'change-type') {
			plan = buildChangeColumnTypePlan({
				tableName: table.name,
				columnName: column.name,
				currentColumnType: column.type,
				newColumnType,
				existingColumnNames
			});
		} else {
			plan = buildDropColumnPlan({
				tableName: table.name,
				columnName: column.name,
				existingColumnNames
			});
		}
		return plan;
	});

	// Renaming breaks references and needs a deliberate phrase; a description change is safe.
	const confirmationPhrase = $derived(
		action === 'edit'
			? renames
				? 'RENAME'
				: 'RUN'
			: action === 'change-type'
				? `CHANGE TYPE ${table.name}.${column.name}`
				: `${table.name}.${column.name}`
	);

	$effect(() => {
		const target = open
			? `${databaseName}\u0000${table.name}\u0000${column.name}\u0000${action}`
			: '';
		if (!target || target === initializedTarget) return;
		initializedTarget = target;
		newColumnName = column.name;
		newColumnDocstring = column.docstring ?? '';
		newColumnType = '';
		reviewPlan.reset();
	});

	$effect(() => {
		if (!open) initializedTarget = '';
	});

	function submitMutation() {
		if (
			!reviewPlan.prepared.plan ||
			!preflightReady ||
			!reviewPlan.canSubmit(confirmationPhrase, preflightReady && !isBusy) ||
			isBusy
		) {
			return;
		}
		onsubmit?.(reviewPlan.prepared.plan);
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
				{action === 'edit'
					? `Edit ${column.name}`
					: action === 'change-type'
						? `Change ${column.name} type`
						: `Remove ${column.name}`}
			</Dialog.Title>
			<Dialog.Description id="column-mutation-description">
				{action === 'edit'
					? 'Change this column’s name or description. Its stored values are kept.'
					: action === 'change-type'
						? 'Directly replace this column type and permanently clear its existing values.'
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
						<dd class="font-medium break-words">{clusterName}</dd>
					</div>
					<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
						<dt class="text-muted-foreground">Target</dt>
						<dd class="font-mono break-all">{databaseName} / {table.name}.{column.name}</dd>
					</div>
					<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
						<dt class="text-muted-foreground">Type</dt>
						<dd><Badge variant="outline" class="font-mono">{column.type}</Badge></dd>
					</div>
					<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
						<dt class="text-muted-foreground">Risk</dt>
						<dd>
							{#if action === 'edit' && !renames}
								<Badge variant="outline">Safe</Badge>
							{:else}
								<Badge variant="destructive">
									{action === 'edit' ? 'Breaking change' : 'Irreversible data loss'}
								</Badge>
							{/if}
						</dd>
					</div>
					{#if snapshot}
						<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
							<dt class="text-muted-foreground">Verified</dt>
							<dd class="min-w-0">
								<p>Current schema checked</p>
								{#if snapshot.tableId}
									<p class="mt-1 truncate font-mono text-[11px] text-muted-foreground">
										Table ID: {snapshot.tableId}
									</p>
								{/if}
								{#if snapshot.totalRowCount != null}
									<p class="mt-1 text-[11px] text-muted-foreground">
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
						<CircleAlertIcon class="size-4 shrink-0 text-destructive" />
						<span class="text-destructive">Schema verification is required before execution.</span>
					{/if}
				</div>

				{#if action === 'edit'}
					<div class="space-y-4">
						<div>
							<label class="text-sm font-medium" for="new-column-name">Column name</label>
							<Input
								id="new-column-name"
								class="mt-2 font-mono"
								bind:value={newColumnName}
								disabled={isBusy}
								autocomplete="off"
							/>
						</div>
						<div>
							<label class="text-sm font-medium" for="new-column-description">
								Description <span class="font-normal text-muted-foreground">(optional)</span>
							</label>
							<Textarea
								id="new-column-description"
								class="mt-2 min-h-20 resize-y"
								bind:value={newColumnDocstring}
								disabled={isBusy}
								maxlength={1000}
								placeholder="Describe this column"
							/>
						</div>
						{#if reviewPlan.prepared.error && editsSomething}
							<p class="text-xs text-destructive">{reviewPlan.prepared.error}</p>
						{/if}
					</div>
				{:else if action === 'change-type'}
					<div>
						<label class="text-sm font-medium" for="new-column-type">New column type</label>
						<Select.Root type="single" bind:value={newColumnType} disabled={isBusy}>
							<Select.Trigger id="new-column-type" class="mt-2 w-full font-mono">
								<Select.Value placeholder="Select a new type" />
							</Select.Trigger>
							<Select.Content>
								<Select.Group>
									{#each KUSTO_SCALAR_TYPES.filter((type) => type !== column.type) as type (type)}
										<Select.Item value={type} label={type} />
									{/each}
								</Select.Group>
							</Select.Content>
						</Select.Root>
						<p class="mt-1.5 text-xs text-muted-foreground">
							Current type: <span class="font-mono">{column.type}</span>
						</p>
						{#if reviewPlan.prepared.error && newColumnType}
							<p class="mt-1.5 text-xs text-destructive">{reviewPlan.prepared.error}</p>
						{/if}
					</div>
				{/if}

				{#if reviewPlan.prepared.plan}
					<div>
						<h3 class="mb-2 text-sm font-medium">Management command</h3>
						<pre
							class="max-h-36 overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{formatPlanCommands(
								reviewPlan.prepared.plan
							)}</pre>
					</div>
				{/if}

				{#if action !== 'edit' || renames}
					<div class="rounded-lg border border-warning/40 bg-warning/10 p-3">
						<div class="flex items-start gap-2 text-warning">
							<CircleAlertIcon class="mt-0.5 size-4 shrink-0" />
							<div>
								<p class="text-sm font-medium">
									{action === 'edit'
										? 'Dependent references are not rewritten'
										: action === 'change-type'
											? 'Every existing value in this column will become null'
											: 'Deleted column data cannot be recovered'}
								</p>
								<p class="mt-1 text-xs leading-5">
									{action === 'edit'
										? 'Stored functions, ingestion mappings, policies, dashboards, and client queries may still reference the old name and can fail after this change.'
										: action === 'change-type'
											? 'Kusto does not convert the stored values. After this direct type change, the original data is permanently unrecoverable—even if you change the column back to its current type.'
											: 'All values in this column become unqueryable. Adding a column with the same name later will not restore them.'}
								</p>
							</div>
						</div>
					</div>
				{/if}

				<div>
					<label class="text-sm font-medium" for="confirm-column-mutation">
						Type <span class="font-mono">{confirmationPhrase}</span> to confirm
					</label>
					<Input
						id="confirm-column-mutation"
						class="mt-2 font-mono"
						bind:value={reviewPlan.state.confirmationText}
						disabled={isBusy}
						autocomplete="off"
					/>
				</div>

				{#if executionError}
					<p
						class="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs whitespace-pre-wrap text-destructive"
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
					{action === 'edit'
						? 'Saving column'
						: action === 'change-type'
							? 'Changing column type'
							: 'Removing column'}
				</Button>
			{:else}
				<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button
					variant={action === 'edit' ? 'default' : 'destructive'}
					disabled={!reviewPlan.prepared.plan ||
						!preflightReady ||
						reviewPlan.state.confirmationText !== confirmationPhrase}
					onclick={submitMutation}
				>
					{#if action === 'edit'}
						<PencilIcon /> Save column
					{:else if action === 'change-type'}
						<BinaryIcon /> Change type
					{:else}
						<Trash2Icon /> Remove column
					{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
