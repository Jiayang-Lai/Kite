<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SaveIcon from '@lucide/svelte/icons/save';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Select from '$lib/components/ui/select';
	import { Spinner } from '$lib/components/ui/spinner';
	import { Textarea } from '$lib/components/ui/textarea';
	import { createReviewablePlan } from '$lib/admin/reviewable-plan.svelte';
	import {
		buildTableMutationPlan,
		KUSTO_SCALAR_TYPES,
		type KustoScalarType,
		type TableMutationPlan,
		type TableSchemaSnapshot
	} from '$lib/kusto/table-management';
	import type { KustoTable } from '$lib/types/kusto-schema';

	type NewColumnDraft = {
		id: number;
		name: string;
		type: KustoScalarType;
	};

	type TableEditorDialogProps = {
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
	}: TableEditorDialogProps = $props();

	let nextColumnId = 1;
	let initializedTarget = '';
	let docstring = $state('');
	let newColumns = $state<NewColumnDraft[]>([]);
	const isBusy = $derived(isPreparing || isRunning);

	const reviewPlan = createReviewablePlan(() =>
		buildTableMutationPlan({
			tableName: table.name,
			currentDocstring: table.docstring,
			nextDocstring: docstring,
			existingColumnNames: table.columns.map((column) => column.name),
			newColumns
		})
	);

	$effect(() => {
		const target = open ? `${databaseName}\u0000${table.name}` : '';
		if (!target || target === initializedTarget) return;

		initializedTarget = target;
		docstring = table.docstring ?? '';
		newColumns = [];
		reviewPlan.reset();
	});

	$effect(() => {
		if (!open) initializedTarget = '';
	});

	function addColumn() {
		if (isBusy) return;
		newColumns = [
			...newColumns,
			{ id: nextColumnId++, name: '', type: 'string' as KustoScalarType }
		];
		reviewPlan.reset();
	}

	function removeColumn(columnId: number) {
		if (isBusy) return;
		newColumns = newColumns.filter((column) => column.id !== columnId);
		reviewPlan.reset();
	}

	function reviewChanges() {
		reviewPlan.startReview(preflightReady && !isBusy);
	}

	function returnToEditor() {
		reviewPlan.returnToEditor(!isBusy);
	}

	function submitChanges() {
		const plan = reviewPlan.prepared.plan;
		if (!plan || !reviewPlan.canSubmit('RUN', preflightReady && !isBusy)) return;
		onsubmit?.(plan);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="grid h-[min(90dvh,52rem)] w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden sm:max-w-2xl"
		showCloseButton={!isBusy}
		aria-describedby="table-editor-description"
	>
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title
				>{reviewPlan.state.reviewing ? 'Review table update' : `Edit ${table.name}`}</Dialog.Title
			>
			<Dialog.Description id="table-editor-description">
				{reviewPlan.state.reviewing
					? 'Confirm the target and generated management command.'
					: 'Update the description or append columns without replacing the existing schema.'}
			</Dialog.Description>
		</Dialog.Header>

		<ScrollArea
			class="h-full min-h-0 overflow-hidden overscroll-contain"
			orientation="vertical"
			type="auto"
			scrollbarYClasses="py-1"
		>
			<div class="p-4 pr-5">
				{#if reviewPlan.state.reviewing && reviewPlan.prepared.plan}
					<div class="space-y-5">
						<dl class="divide-y rounded-lg border text-sm">
							<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
								<dt class="text-muted-foreground">Cluster</dt>
								<dd class="break-words font-medium">{clusterName}</dd>
							</div>
							<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
								<dt class="text-muted-foreground">Database</dt>
								<dd class="break-all font-mono">{databaseName}</dd>
							</div>
							<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
								<dt class="text-muted-foreground">Table</dt>
								<dd class="break-all font-mono">{table.name}</dd>
							</div>
							<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
								<dt class="text-muted-foreground">Changes</dt>
								<dd>{reviewPlan.prepared.plan.summary}</dd>
							</div>
							<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
								<dt class="text-muted-foreground">Risk</dt>
								<dd>
									<Badge variant="outline" class="capitalize">{reviewPlan.prepared.plan.risk}</Badge
									>
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

						<div>
							<h3 class="mb-2 text-sm font-medium">Management command</h3>
							<pre
								class="bg-muted max-h-48 overflow-auto rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">{reviewPlan
									.prepared.plan.command}</pre>
						</div>

						<div class="border-warning/40 bg-warning/10 rounded-lg border p-3">
							<div class="text-warning flex items-start gap-2">
								<CircleAlertIcon class="mt-0.5 size-4 shrink-0" />
								<div>
									<p class="text-sm font-medium">This changes cluster state</p>
									<p class="mt-1 text-xs leading-5">
										Existing columns are preserved. New columns are appended with null values for
										existing rows. Kusto will enforce your table permissions.
									</p>
								</div>
							</div>
						</div>

						<div>
							<label class="text-sm font-medium" for="confirm-table-update">
								Type RUN to enable the update
							</label>
							<Input
								id="confirm-table-update"
								class="mt-2"
								bind:value={reviewPlan.state.confirmationText}
								disabled={isBusy}
								autocomplete="off"
							/>
						</div>
					</div>
				{:else}
					<div class="space-y-6">
						<dl class="grid gap-2 rounded-lg border bg-muted/20 p-3 text-xs sm:grid-cols-2">
							<div>
								<dt class="text-muted-foreground">Cluster</dt>
								<dd class="mt-0.5 break-words font-medium">{clusterName}</dd>
							</div>
							<div>
								<dt class="text-muted-foreground">Database / table</dt>
								<dd class="mt-0.5 break-all font-mono">{databaseName} / {table.name}</dd>
							</div>
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
									The table will be checked again immediately before the update.
								</span>
							{:else}
								<CircleAlertIcon class="text-destructive size-4 shrink-0" />
								<span class="text-destructive">Schema verification is required before review.</span>
							{/if}
						</div>

						<div>
							<label class="text-sm font-medium" for="table-docstring">Description</label>
							<Textarea
								id="table-docstring"
								class="mt-2 min-h-24 resize-y"
								bind:value={docstring}
								disabled={isBusy}
								maxlength={1000}
								placeholder="Describe this table"
							/>
						</div>

						<section aria-labelledby="existing-columns-heading">
							<div class="mb-2 flex items-center justify-between gap-3">
								<h3 id="existing-columns-heading" class="text-sm font-medium">Existing columns</h3>
								<Badge variant="secondary">{table.columns.length}</Badge>
							</div>
							<div class="divide-y rounded-lg border">
								{#each table.columns as column (column.name)}
									<div class="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
										<span class="min-w-0 break-all font-mono text-xs">{column.name}</span>
										<Badge variant="outline" class="shrink-0 font-mono text-[11px]">
											{column.type}
										</Badge>
									</div>
								{:else}
									<p class="text-muted-foreground p-3 text-xs">This table has no columns.</p>
								{/each}
							</div>
							<p class="text-muted-foreground mt-2 text-xs">
								Existing names and types are locked because changing them can destroy stored values.
							</p>
						</section>

						<section aria-labelledby="new-columns-heading">
							<div class="mb-2 flex items-center justify-between gap-3">
								<div>
									<h3 id="new-columns-heading" class="text-sm font-medium">New columns</h3>
									<p class="text-muted-foreground mt-0.5 text-xs">
										New columns are appended in this order.
									</p>
								</div>
								<Button variant="outline" size="sm" onclick={addColumn} disabled={isBusy}>
									<PlusIcon /> Add column
								</Button>
							</div>

							<div class="space-y-2">
								{#each newColumns as column, index (column.id)}
									<div
										class="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
									>
										<div>
											<label class="text-muted-foreground text-xs" for={`new-column-${column.id}`}>
												Column name
											</label>
											<Input
												id={`new-column-${column.id}`}
												class="mt-1 font-mono"
												bind:value={column.name}
												disabled={isBusy}
												placeholder={`Column${index + 1}`}
												autocomplete="off"
											/>
										</div>
										<div>
											<label
												class="text-muted-foreground text-xs"
												for={`new-column-type-${column.id}`}>Type</label
											>
											<Select.Root type="single" bind:value={column.type} disabled={isBusy}>
												<Select.Trigger id={`new-column-type-${column.id}`} class="mt-1 w-full">
													<Select.Value />
												</Select.Trigger>
												<Select.Content>
													<Select.Group>
														{#each KUSTO_SCALAR_TYPES as type (type)}
															<Select.Item value={type} label={type} />
														{/each}
													</Select.Group>
												</Select.Content>
											</Select.Root>
										</div>
										<Button
											variant="ghost"
											size="icon-sm"
											class="self-end"
											disabled={isBusy}
											onclick={() => removeColumn(column.id)}
											aria-label={`Remove ${column.name || `column ${index + 1}`}`}
										>
											<Trash2Icon />
										</Button>
									</div>
								{:else}
									<div
										class="text-muted-foreground rounded-lg border border-dashed p-5 text-center text-xs"
									>
										No columns will be added.
									</div>
								{/each}
							</div>
						</section>
					</div>
				{/if}

				{#if executionError}
					<p
						class="text-destructive bg-destructive/5 mt-4 whitespace-pre-wrap rounded-lg border border-destructive/20 p-3 text-xs"
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
				<Button disabled>
					<Spinner /> Checking current schema
				</Button>
			{:else if isRunning}
				<Button variant="outline" onclick={() => oncancel?.()}>
					<Spinner /> Stop waiting
				</Button>
				<Button disabled>
					<Spinner /> Updating table
				</Button>
			{:else if reviewPlan.state.reviewing}
				<Button variant="outline" onclick={returnToEditor}>Back</Button>
				<Button
					disabled={!preflightReady || reviewPlan.state.confirmationText !== 'RUN'}
					onclick={submitChanges}
				>
					<SaveIcon /> Update table
				</Button>
			{:else}
				<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button disabled={!reviewPlan.prepared.plan || !preflightReady} onclick={reviewChanges}>
					Review changes
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
