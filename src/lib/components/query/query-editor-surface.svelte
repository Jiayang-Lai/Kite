<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { mode } from 'mode-watcher';

	import type { QueryTab } from '$lib/cluster/cluster-session.svelte';
	import MonacoEditor, { type EditorDiagnostic } from '$lib/components/query/monaco-editor.svelte';
	import * as Select from '$lib/components/ui/select';
	import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

	type QueryEditorSurfaceProps = {
		activeTabId: string;
		queryText: string;
		selectedDatabase: string;
		databaseSchema: KustoDatabaseSchema;
		clusterUrl?: string;
		comparisonOriginalTabId?: string;
		originalTab?: QueryTab;
		modifiedTab?: QueryTab;
		compareCandidates: QueryTab[];
		titleFor: (tab: QueryTab) => string;
		onexecute: () => void;
		onexecutecomparison: (side: 'left' | 'right') => void;
		onquerychange: (value: string) => void;
		onmodifiedchange: (value: string) => void;
		onoriginalchange: (value: string) => void;
		oncomparisonoriginalchange: (tabId: string) => void;
		oncomparisonsidechange: (side: 'left' | 'right') => void;
		onlanguagestatuschange: (status: 'idle' | 'loading' | 'ready') => void;
	};

	let {
		activeTabId,
		queryText,
		selectedDatabase,
		databaseSchema,
		clusterUrl,
		comparisonOriginalTabId,
		originalTab,
		modifiedTab,
		compareCandidates,
		titleFor,
		onexecute,
		onexecutecomparison,
		onquerychange,
		onmodifiedchange,
		onoriginalchange,
		oncomparisonoriginalchange,
		oncomparisonsidechange,
		onlanguagestatuschange
	}: QueryEditorSurfaceProps = $props();

	let editor = $state<{ getDiagnostics: () => EditorDiagnostic[] }>();
	const editorTheme = $derived(mode.current === 'dark' ? 'vs-dark' : 'vs');

	export function getDiagnostics() {
		return editor?.getDiagnostics() ?? [];
	}
</script>

{#if originalTab && modifiedTab}
	<section class="flex min-h-0 flex-1 flex-col" aria-label="Query comparison">
		<div class="flex h-10 shrink-0 items-center gap-3 border-b bg-muted/20 px-3 text-xs">
			<div class="flex min-w-0 flex-1 items-center gap-2">
				<span class="hidden shrink-0 font-medium text-muted-foreground sm:inline">Diff</span>
				<span class="hidden shrink-0 text-muted-foreground md:inline">Reference</span>
				<label class="sr-only" for="comparison-original-tab">Reference query</label>
				<Select.Root
					type="single"
					value={comparisonOriginalTabId}
					onValueChange={oncomparisonoriginalchange}
				>
					<Select.Trigger id="comparison-original-tab" size="sm" class="max-w-44">
						<span data-slot="select-value" class="min-w-0 truncate">
							{titleFor(originalTab)}
						</span>
					</Select.Trigger>
					<Select.Content>
						<Select.Group>
							{#each compareCandidates as tab (tab.id)}
								<Select.Item value={tab.id} label={titleFor(tab)} />
							{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
				<ArrowRightIcon class="shrink-0 text-muted-foreground" />
				<span class="hidden shrink-0 text-muted-foreground md:inline">Current</span>
				<span
					class="max-w-44 truncate rounded-sm bg-primary/10 px-1.5 py-1 font-medium text-foreground ring-1 ring-primary/30"
					title={titleFor(modifiedTab)}
				>
					{titleFor(modifiedTab)}
				</span>
			</div>
			<div
				class="hidden shrink-0 border-l pl-3 font-mono text-muted-foreground lg:block"
				title={modifiedTab.database}
			>
				DB: {modifiedTab.database}
			</div>
		</div>
		{#key `${modifiedTab.id}:${originalTab.id}`}
			<MonacoEditor
				bind:this={editor}
				value={modifiedTab.query}
				originalValue={originalTab.query}
				class="min-h-0 flex-1"
				database={modifiedTab.database}
				height="100%"
				{databaseSchema}
				{clusterUrl}
				theme={editorTheme}
				syncValue={false}
				onexecute={onexecutecomparison}
				onvaluechange={onmodifiedchange}
				onoriginalvaluechange={onoriginalchange}
				onactivesidechange={oncomparisonsidechange}
				{onlanguagestatuschange}
			/>
		{/key}
	</section>
{:else}
	{#key activeTabId}
		<MonacoEditor
			bind:this={editor}
			value={queryText}
			class="min-h-0 flex-1"
			database={selectedDatabase}
			height="100%"
			{databaseSchema}
			{clusterUrl}
			theme={editorTheme}
			syncValue={false}
			{onexecute}
			onvaluechange={onquerychange}
			{onlanguagestatuschange}
		/>
	{/key}
{/if}
