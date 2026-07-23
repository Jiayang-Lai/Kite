<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

	import { Badge } from '$lib/components/ui/badge';
	import type { TableSchemaChangeKind, TableSchemaDiff } from '$lib/kusto/table-management';
	import { cn } from '$lib/utils';

	type TableSchemaDiffProps = {
		diff: TableSchemaDiff;
	};

	let { diff }: TableSchemaDiffProps = $props();

	const labels: Record<TableSchemaChangeKind, string> = {
		added: 'Added',
		removed: 'Removed',
		reordered: 'Reordered',
		renamed: 'Renamed',
		'type-changed': 'Type changed'
	};

	function columnClasses(changes: readonly TableSchemaChangeKind[], side: 'before' | 'after') {
		return cn(
			'min-w-0 rounded-md border p-2',
			side === 'before' && changes.includes('removed') && 'border-destructive/30 bg-destructive/5',
			side === 'after' && changes.includes('added') && 'border-emerald-500/30 bg-emerald-500/5',
			changes.includes('type-changed') && 'border-destructive/40',
			changes.includes('renamed') && 'border-warning/40 bg-warning/5',
			changes.includes('reordered') && 'ring-primary/20 ring-1'
		);
	}
</script>

<div class="space-y-2">
	<div class="flex flex-wrap gap-1.5">
		{#each Object.entries(diff.counts) as [change, count] (change)}
			{#if count}
				<Badge
					variant={change === 'removed' || change === 'type-changed' ? 'destructive' : 'outline'}
				>
					{count}
					{labels[change as TableSchemaChangeKind].toLowerCase()}
				</Badge>
			{/if}
		{/each}
		{#if !diff.hasChanges}<Badge variant="outline">No schema changes</Badge>{/if}
	</div>

	<div class="overflow-hidden rounded-lg border">
		<div
			class="bg-muted/40 text-muted-foreground grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] gap-2 border-b px-3 py-2 text-[10px] font-semibold tracking-wider uppercase"
		>
			<span>Before</span>
			<span></span>
			<span>After</span>
		</div>
		<div class="divide-y">
			{#each diff.rows as row, index (`${row.sourceIndex ?? 'new'}-${index}`)}
				<div class="grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] gap-2 p-2.5">
					{#if row.before}
						<div class={columnClasses(row.changes, 'before')}>
							<p class="text-muted-foreground text-[10px]">Position {row.before.index + 1}</p>
							<p class="mt-0.5 break-all font-mono text-xs">
								{row.before.name}:<span class="text-muted-foreground">{row.before.type}</span>
							</p>
						</div>
					{:else}
						<div
							class="text-muted-foreground grid min-h-12 place-items-center rounded-md border border-dashed text-xs"
						>
							—
						</div>
					{/if}

					<div class="text-muted-foreground grid place-items-center">
						<ArrowRightIcon class="size-3.5" />
					</div>

					{#if row.after}
						<div class={columnClasses(row.changes, 'after')}>
							<p class="text-muted-foreground text-[10px]">Position {row.after.index + 1}</p>
							<p class="mt-0.5 break-all font-mono text-xs">
								{row.after.name}:<span class="text-muted-foreground">{row.after.type}</span>
							</p>
						</div>
					{:else}
						<div
							class="text-muted-foreground grid min-h-12 place-items-center rounded-md border border-dashed text-xs"
						>
							—
						</div>
					{/if}

					{#if row.changes.length}
						<div class="col-span-3 flex flex-wrap gap-1 pt-0.5">
							{#each row.changes as change (change)}
								<Badge
									variant={change === 'removed' || change === 'type-changed'
										? 'destructive'
										: 'outline'}
									class="text-[10px]"
								>
									{labels[change]}
								</Badge>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>
