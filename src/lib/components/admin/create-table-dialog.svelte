<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import FileUpIcon from '@lucide/svelte/icons/file-up';
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
	import {
		buildCreateTablePlan,
		KUSTO_SCALAR_TYPES,
		type CreateTablePlan,
		type KustoScalarType
	} from '$lib/kusto/table-management';
	import { readAvroTableTemplate } from '$lib/kusto/avro-table-template';

	type NewColumnDraft = {
		id: number;
		name: string;
		type: KustoScalarType;
		docstring: string;
	};

	type CreateTableDialogProps = {
		open?: boolean;
		databaseName: string;
		clusterName: string;
		existingTableNames: readonly string[];
		isRunning?: boolean;
		executionError?: string;
		onsubmit?: (plan: CreateTablePlan) => void;
		oncancel?: () => void;
	};

	let {
		open = $bindable(false),
		databaseName,
		clusterName,
		existingTableNames,
		isRunning = false,
		executionError = '',
		onsubmit,
		oncancel
	}: CreateTableDialogProps = $props();

	let nextColumnId = 1;
	let initializedDatabase = '';
	let tableName = $state('');
	let docstring = $state('');
	let folder = $state('');
	let columns = $state<NewColumnDraft[]>([]);
	let reviewing = $state(false);
	let confirmationText = $state('');
	let templateImportError = $state('');
	let importedTemplateName = $state('');
	let templateInput = $state<HTMLInputElement>();
	const confirmationPhrase = $derived(`CREATE ${tableName.trim()}`);

	const preparedPlan = $derived.by(() => {
		try {
			return {
				plan: buildCreateTablePlan({
					tableName,
					existingTableNames,
					columns,
					docstring,
					folder
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
		const target = open ? databaseName : '';
		if (!target || target === initializedDatabase) return;
		initializedDatabase = target;
		tableName = '';
		docstring = '';
		folder = '';
		columns = [{ id: nextColumnId++, name: '', type: 'string', docstring: '' }];
		reviewing = false;
		confirmationText = '';
		templateImportError = '';
		importedTemplateName = '';
	});

	$effect(() => {
		if (!open) initializedDatabase = '';
	});

	function addColumn() {
		if (isRunning) return;
		columns = [...columns, { id: nextColumnId++, name: '', type: 'string', docstring: '' }];
	}

	function removeColumn(id: number) {
		if (isRunning || columns.length <= 1) return;
		columns = columns.filter((column) => column.id !== id);
	}

	function reviewTable() {
		if (!preparedPlan.plan || isRunning) return;
		confirmationText = '';
		reviewing = true;
	}

	function returnToEditor() {
		if (isRunning) return;
		confirmationText = '';
		reviewing = false;
	}

	function submitTable() {
		if (
			!preparedPlan.plan ||
			confirmationText !== `CREATE ${preparedPlan.plan.tableName}` ||
			isRunning
		) {
			return;
		}
		onsubmit?.(preparedPlan.plan);
	}

	function openTemplatePicker() {
		if (!isRunning) templateInput?.click();
	}

	async function importTemplate(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || isRunning) return;

		templateImportError = '';
		try {
			const template = await readAvroTableTemplate(file);
			if (isRunning) return;
			tableName = template.tableName;
			docstring = template.docstring;
			folder = template.folder;
			columns = template.columns.map((column) => ({
				id: nextColumnId++,
				...column,
				docstring: column.docstring ?? ''
			}));
			importedTemplateName = file.name;
		} catch (error) {
			templateImportError = error instanceof Error ? error.message : String(error);
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="grid h-[min(90dvh,52rem)] w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden sm:max-w-2xl"
		showCloseButton={!isRunning}
		aria-describedby="create-table-dialog-description"
	>
		<Dialog.Header class="border-b p-5 pr-14">
			<Dialog.Title>{reviewing ? 'Review new table' : 'New table'}</Dialog.Title>
			<Dialog.Description id="create-table-dialog-description">
				{reviewing
					? 'Confirm the initial schema and generated management command.'
					: `Create an empty table in ${databaseName} with an explicit initial schema.`}
			</Dialog.Description>
		</Dialog.Header>

		<ScrollArea
			class="h-full min-h-0 overflow-hidden overscroll-contain"
			orientation="vertical"
			type="auto"
			scrollbarYClasses="py-1"
		>
			<div class="space-y-5 p-4 pr-5">
				{#if reviewing && preparedPlan.plan}
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
							<dd class="break-all font-mono">{preparedPlan.plan.tableName}</dd>
						</div>
						<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
							<dt class="text-muted-foreground">Schema</dt>
							<dd>
								{preparedPlan.plan.columns.length}
								{preparedPlan.plan.columns.length === 1 ? 'column' : 'columns'}
							</dd>
						</div>
						<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3">
							<dt class="text-muted-foreground">Risk</dt>
							<dd><Badge variant="outline">Safe · empty table</Badge></dd>
						</div>
					</dl>

					<div>
						<h3 class="mb-2 text-sm font-medium">Initial columns</h3>
						<div class="divide-y overflow-hidden rounded-lg border">
							{#each preparedPlan.plan.columns as column, index (column.name)}
								<div class="flex items-start gap-3 px-3 py-2.5">
									<span class="text-muted-foreground w-5 font-mono text-xs">{index + 1}</span>
									<div class="min-w-0 flex-1">
										<p class="break-all font-mono text-xs">{column.name}</p>
										{#if column.docstring}
											<p class="text-muted-foreground mt-0.5 text-xs">{column.docstring}</p>
										{/if}
									</div>
									<Badge variant="outline" class="font-mono text-[11px]">{column.type}</Badge>
								</div>
							{/each}
						</div>
					</div>

					<div>
						<h3 class="mb-2 text-sm font-medium">Management command</h3>
						<pre
							class="bg-muted max-h-48 overflow-auto rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">{preparedPlan
								.plan.columnDocstringsCommand
								? `${preparedPlan.plan.command}\n${preparedPlan.plan.columnDocstringsCommand}`
								: preparedPlan.plan.command}</pre>
					</div>

					<div class="border-primary/30 bg-primary/5 rounded-lg border p-3">
						<div class="flex items-start gap-2">
							<CircleAlertIcon class="text-primary mt-0.5 size-4 shrink-0" />
							<div>
								<p class="text-sm font-medium">The table starts empty</p>
								<p class="text-muted-foreground mt-1 text-xs leading-5">
									Kite refreshes the database immediately before creation to ensure this name is
									still available, then refreshes the schema again after the command succeeds.
								</p>
							</div>
						</div>
					</div>

					<div>
						<label class="text-sm font-medium" for="confirm-create-table">
							Type <span class="font-mono">{confirmationPhrase}</span> to confirm
						</label>
						<Input
							id="confirm-create-table"
							class="mt-2 font-mono"
							bind:value={confirmationText}
							disabled={isRunning}
							autocomplete="off"
						/>
					</div>
				{:else}
					<input
						bind:this={templateInput}
						type="file"
						accept=".avsc,.json,application/vnd.apache.avro.schema+json,application/json"
						class="sr-only"
						onchange={importTemplate}
					/>
					<dl class="grid gap-2 rounded-lg border bg-muted/20 p-3 text-xs sm:grid-cols-2">
						<div>
							<dt class="text-muted-foreground">Cluster</dt>
							<dd class="mt-0.5 break-words font-medium">{clusterName}</dd>
						</div>
						<div>
							<dt class="text-muted-foreground">Database</dt>
							<dd class="mt-0.5 break-all font-mono">{databaseName}</dd>
						</div>
					</dl>

					<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
						<div>
							<p class="text-sm font-medium">Import Avro template</p>
							<p class="text-muted-foreground mt-0.5 text-xs">
								Import one <code>.avsc</code> record schema to replace this draft, then edit it if needed.
							</p>
						</div>
						<Button variant="outline" size="sm" onclick={openTemplatePicker} disabled={isRunning}>
							<FileUpIcon /> Import JSON template
						</Button>
					</div>

					{#if importedTemplateName}
						<p class="text-muted-foreground text-xs">Imported {importedTemplateName}.</p>
					{/if}
					{#if templateImportError}
						<p class="text-destructive text-xs" role="alert">{templateImportError}</p>
					{/if}

					<div>
						<label class="text-sm font-medium" for="create-table-name">Table name</label>
						<Input
							id="create-table-name"
							class="mt-2 font-mono"
							bind:value={tableName}
							disabled={isRunning}
							placeholder="Events"
							autocomplete="off"
						/>
					</div>

					<div>
						<label class="text-sm font-medium" for="create-table-description"
							>Description <span class="text-muted-foreground font-normal">(optional)</span></label
						>
						<Textarea
							id="create-table-description"
							class="mt-2 min-h-20"
							bind:value={docstring}
							disabled={isRunning}
							placeholder="Describe this table"
						/>
					</div>

					<div>
						<label class="text-sm font-medium" for="create-table-folder">
							Folder <span class="text-muted-foreground font-normal">(optional)</span>
						</label>
						<Input
							id="create-table-folder"
							class="mt-2"
							bind:value={folder}
							disabled={isRunning}
							placeholder="Operations"
							autocomplete="off"
						/>
					</div>

					<section aria-labelledby="create-table-columns-heading">
						<div class="mb-2 flex items-end justify-between gap-3">
							<div>
								<h3 id="create-table-columns-heading" class="text-sm font-medium">Columns</h3>
								<p class="text-muted-foreground mt-0.5 text-xs">
									Column order becomes the initial table schema.
								</p>
							</div>
							<Button variant="outline" size="sm" onclick={addColumn} disabled={isRunning}>
								<PlusIcon /> Add column
							</Button>
						</div>

						<div class="space-y-2">
							{#each columns as column, index (column.id)}
								<div
									class="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-end gap-2 rounded-lg border px-3 pt-2 pb-3"
								>
									<div>
										<label class="text-muted-foreground text-xs" for={`create-column-${column.id}`}
											>Column name</label
										>
										<Input
											id={`create-column-${column.id}`}
											class="mt-1 font-mono"
											bind:value={column.name}
											disabled={isRunning}
											placeholder={`Column${index + 1}`}
											autocomplete="off"
										/>
									</div>
									<div>
										<label
											class="text-muted-foreground text-xs"
											for={`create-column-type-${column.id}`}>Type</label
										>
										<Select.Root type="single" bind:value={column.type} disabled={isRunning}>
											<Select.Trigger
												id={`create-column-type-${column.id}`}
												class="mt-1 w-full font-mono"
											>
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
									<div class="col-span-full">
										<label
											class="text-muted-foreground text-xs"
											for={`create-column-description-${column.id}`}
										>
											Column description <span class="font-normal">(optional)</span>
										</label>
										<Textarea
											id={`create-column-description-${column.id}`}
											class="mt-1 min-h-16"
											bind:value={column.docstring}
											disabled={isRunning}
											placeholder="Describe this column"
										/>
									</div>
									<Button
										variant="ghost"
										size="icon-sm"
										disabled={isRunning || columns.length <= 1}
										onclick={() => removeColumn(column.id)}
										aria-label={`Remove ${column.name || `column ${index + 1}`}`}
									>
										<Trash2Icon />
									</Button>
								</div>
							{/each}
						</div>
					</section>

					{#if preparedPlan.error && (tableName.trim() || columns.some( (column) => column.name.trim() ))}
						<p class="text-destructive text-xs">{preparedPlan.error}</p>
					{/if}
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
			{#if isRunning}
				<Button variant="outline" onclick={() => oncancel?.()}>
					<Spinner /> Stop waiting
				</Button>
				<Button disabled><Spinner /> Creating table</Button>
			{:else if reviewing}
				<Button variant="outline" onclick={returnToEditor}>Back</Button>
				<Button
					disabled={!preparedPlan.plan ||
						confirmationText !== `CREATE ${preparedPlan.plan.tableName}`}
					onclick={submitTable}
				>
					<SaveIcon /> Create table
				</Button>
			{:else}
				<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button disabled={!preparedPlan.plan} onclick={reviewTable}>Review table</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
