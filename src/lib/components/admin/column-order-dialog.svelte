<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import SaveIcon from '@lucide/svelte/icons/save';
	import { tick } from 'svelte';

	import TableSchemaDiff from '$lib/components/admin/table-schema-diff.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Spinner } from '$lib/components/ui/spinner';
	import {
		buildReorderTableColumnsPlan,
		diffTableSchema,
		type TableMutationPlan,
		type TableSchemaSnapshot
	} from '$lib/kusto/table-management';
	import type { KustoTable } from '$lib/types/kusto-schema';

	type OrderedColumn = {
		sourceIndex: number;
		name: string;
		type: string;
	};

	type ColumnOrderDialogProps = {
		open?: boolean;
		table: KustoTable;
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
		table,
		databaseName,
		clusterName,
		isPreparing = false,
		isRunning = false,
		preflightReady = false,
		snapshot,
		executionError = '',
		onsubmit,
		oncancel
	}: ColumnOrderDialogProps = $props();

	let initializedTarget = '';
	let orderedColumns = $state<OrderedColumn[]>([]);
	let reviewing = $state(false);
	let confirmationText = $state('');
	let dialogContent = $state<HTMLElement | null>(null);
	let scrollViewport = $state<HTMLElement | null>(null);
	const isBusy = $derived(isPreparing || isRunning);
	const confirmationPhrase = $derived(`REORDER ${table.name}`);
	const schemaDiff = $derived(
		diffTableSchema(
			snapshot?.columns ?? [],
			orderedColumns.map((column) => ({ ...column }))
		)
	);

	const preparedPlan = $derived.by(() => {
		if (!snapshot) return { plan: undefined, error: 'Current table metadata is not verified yet.' };
		try {
			return {
				plan: buildReorderTableColumnsPlan({
					snapshot,
					orderedSourceIndexes: orderedColumns.map((column) => column.sourceIndex)
				}),
				error: ''
			};
		} catch (error) {
			return {
				plan: undefined,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	});

	$effect(() => {
		const currentSnapshot = snapshot;
		if (!open || !currentSnapshot) return;
		const target = `${databaseName}\u0000${table.name}\u0000${currentSnapshot.tableId ?? currentSnapshot.cslSchema ?? ''}`;
		if (target === initializedTarget) return;

		initializedTarget = target;
		orderedColumns = currentSnapshot.columns.map((column, sourceIndex) => ({
			sourceIndex,
			name: column.name,
			type: column.type
		}));
		reviewing = false;
		confirmationText = '';
	});

	$effect(() => {
		if (!open) initializedTarget = '';
	});

	function moveColumn(index: number, direction: -1 | 1) {
		const targetIndex = index + direction;
		if (isBusy || targetIndex < 0 || targetIndex >= orderedColumns.length) return;
		const next = [...orderedColumns];
		[next[index], next[targetIndex]] = [next[targetIndex], next[index]];
		orderedColumns = next;
		reviewing = false;
	}

	function reviewChanges() {
		if (!preparedPlan.plan || !preflightReady || isBusy) return;
		confirmationText = '';
		reviewing = true;
		void resetScrollPosition();
	}

	function returnToEditor() {
		if (isBusy) return;
		confirmationText = '';
		reviewing = false;
		void resetScrollPosition();
	}

	function submitChanges() {
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

	async function resetScrollPosition() {
		await tick();
		scrollViewport?.scrollTo({ top: 0 });
		dialogContent?.focus({ preventScroll: true });
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		bind:ref={dialogContent}
		class="grid h-[min(90dvh,52rem)] w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden sm:max-w-3xl"
		showCloseButton={!isBusy}
		aria-describedby="column-order-description"
		tabindex={-1}
		onOpenAutoFocus={focusDialogWithoutScrolling}
	>
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title
				>{reviewing ? 'Review column order' : `Reorder ${table.name} columns`}</Dialog.Title
			>
			<Dialog.Description id="column-order-description">
				{reviewing
					? 'Confirm the complete order and generated management command.'
					: 'Change only the column order.'}
			</Dialog.Description>
		</Dialog.Header>

		<ScrollArea
			class="h-full min-h-0 overflow-hidden overscroll-contain"
			orientation="vertical"
			type="auto"
			scrollbarYClasses="py-1"
			bind:viewportRef={scrollViewport}
		>
			<div class="space-y-5 p-4 pr-5">
				<dl class="grid gap-2 rounded-lg border bg-muted/20 p-3 text-xs sm:grid-cols-3">
					<div>
						<dt class="text-muted-foreground">Cluster</dt>
						<dd class="mt-0.5 break-words font-medium">{clusterName}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Database / table</dt>
						<dd class="mt-0.5 break-all font-mono">{databaseName} / {table.name}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Preserved</dt>
						<dd class="mt-0.5">Names, types, description, and folder</dd>
					</div>
				</dl>

				<div
					class="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs"
					aria-live="polite"
				>
					{#if isPreparing}
						<Spinner />
						<span>Checking the complete current schema and table identity…</span>
					{:else if preflightReady}
						<Badge variant="outline">Verified</Badge>
						<span class="text-muted-foreground">
							The schema will be checked again immediately before reordering.
						</span>
					{:else}
						<CircleAlertIcon class="text-destructive size-4 shrink-0" />
						<span class="text-destructive">Schema verification is required before review.</span>
					{/if}
				</div>

				{#if !snapshot}
					<div
						class="text-muted-foreground grid min-h-48 place-items-center rounded-lg border border-dashed p-6 text-center text-sm"
					>
						<p>The order editor will load after the current table metadata is verified.</p>
					</div>
				{:else if reviewing && preparedPlan.plan}
					<section aria-labelledby="order-review-diff-heading">
						<h3 id="order-review-diff-heading" class="mb-2 text-sm font-medium">
							Before / after order
						</h3>
						<TableSchemaDiff diff={preparedPlan.plan.diff} />
					</section>

					<div>
						<h3 class="mb-2 text-sm font-medium">Complete management command</h3>
						<pre
							class="bg-muted max-h-48 overflow-auto rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">{preparedPlan
								.plan.command}</pre>
						<p class="text-muted-foreground mt-2 text-xs">
							Every verified column is included exactly once. The description and folder are
							included explicitly.
						</p>
					</div>

					<div class="border-warning/40 bg-warning/10 rounded-lg border p-3">
						<div class="text-warning flex items-start gap-2">
							<CircleAlertIcon class="mt-0.5 size-4 shrink-0" />
							<div>
								<p class="text-sm font-medium">Coordinate order-dependent ingestion</p>
								<p class="mt-1 text-xs leading-5">
									Parallel ingestion that relies on column order can write values into the wrong
									columns. Use mapping objects or stop that ingestion before applying this order.
								</p>
							</div>
						</div>
					</div>

					<div>
						<label class="text-sm font-medium" for="confirm-column-order">
							Type <span class="font-mono">{confirmationPhrase}</span> to confirm
						</label>
						<Input
							id="confirm-column-order"
							class="mt-2 font-mono"
							bind:value={confirmationText}
							disabled={isBusy}
							autocomplete="off"
						/>
					</div>
				{:else}
					<section aria-labelledby="ordered-columns-heading">
						<div class="mb-2">
							<h3 id="ordered-columns-heading" class="text-sm font-medium">Target column order</h3>
							<p class="text-muted-foreground mt-0.5 text-xs">
								Use the arrow controls to create the complete target order.
							</p>
						</div>

						<div class="divide-y overflow-hidden rounded-lg border">
							{#each orderedColumns as column, index (column.sourceIndex)}
								<div
									class="grid grid-cols-[4.5rem_2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
								>
									<div class="flex gap-1">
										<Button
											variant="outline"
											size="icon-xs"
											disabled={isBusy || index === 0}
											onclick={() => moveColumn(index, -1)}
											aria-label={`Move ${column.name} up`}
										>
											<ArrowUpIcon />
										</Button>
										<Button
											variant="outline"
											size="icon-xs"
											disabled={isBusy || index === orderedColumns.length - 1}
											onclick={() => moveColumn(index, 1)}
											aria-label={`Move ${column.name} down`}
										>
											<ArrowDownIcon />
										</Button>
									</div>
									<span class="text-muted-foreground font-mono text-xs">{index + 1}</span>
									<span class="min-w-0 break-all font-mono text-xs">{column.name}</span>
									<Badge variant="outline" class="font-mono text-[11px]">{column.type}</Badge>
								</div>
							{/each}
						</div>
					</section>

					<section aria-labelledby="order-diff-heading">
						<h3 id="order-diff-heading" class="mb-2 text-sm font-medium">Before / after order</h3>
						<TableSchemaDiff diff={schemaDiff} />
					</section>
				{/if}

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
				<Button disabled><Spinner /> Reordering columns</Button>
			{:else if reviewing}
				<Button variant="outline" onclick={returnToEditor}>Back</Button>
				<Button
					disabled={!preflightReady || confirmationText !== confirmationPhrase}
					onclick={submitChanges}
				>
					<SaveIcon /> Apply order
				</Button>
			{:else}
				<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button disabled={!preparedPlan.plan || !preflightReady} onclick={reviewChanges}>
					Review order
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
