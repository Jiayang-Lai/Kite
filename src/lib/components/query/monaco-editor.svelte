<script module lang="ts">
	export type EditorDiagnostic = {
		message: string;
		severity: 'error' | 'warning' | 'info';
		line: number;
		column: number;
		code?: string;
	};

	/**
	 * Monaco models use stable URIs; assigning each component its own ID prevents
	 * two editor instances for the same database from accidentally sharing a model.
	 */
	let nextEditorInstanceId = 0;

	function createEditorInstanceId() {
		nextEditorInstanceId += 1;
		return nextEditorInstanceId;
	}
</script>

<script lang="ts">
	/**
	 * Thin Svelte host for the Monaco-Kusto ESM integration.
	 *
	 * Runtime bootstrapping, Kusto documentation, and worker-schema serialization
	 * live in `$lib/kusto`. This component owns only Svelte bindings, Monaco model
	 * lifecycle, and applying the selected database schema to the public worker API.
	 */
	import { onMount } from 'svelte';

	import { Spinner } from '$lib/components/ui/spinner';
	import { registerDocumentationHoverProvider } from '$lib/kusto/documentation';
	import { type KustoApi, loadKustoRuntime, type MonacoApi } from '$lib/kusto/runtime';
	import { createKustoSchema, getKustoDatabase } from '$lib/kusto/schema';
	import { retainKustoWorker } from '$lib/kusto/worker-lifecycle';
	import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
	import { cn } from '$lib/utils';

	type MonacoEditor =
		import('monaco-editor/esm/vs/editor/editor.api.js').editor.IStandaloneCodeEditor;
	type MonacoDiffEditor =
		import('monaco-editor/esm/vs/editor/editor.api.js').editor.IStandaloneDiffEditor;
	type MonacoModel = import('monaco-editor/esm/vs/editor/editor.api.js').editor.ITextModel;
	type MonacoDisposable = import('monaco-editor/esm/vs/editor/editor.api.js').IDisposable;
	const KUSTO_LANGUAGE_ID = 'kusto';
	type DiffSide = 'left' | 'right';

	type MonacoEditorProps = {
		/** The editor contents. Supports two-way binding with `bind:value`. */
		value?: string;
		/** When supplied, renders Monaco's diff editor with this text on the read-only original side. */
		originalValue?: string;
		/** Monaco theme identifier, such as `vs` or `vs-dark`. */
		theme?: string;
		/** CSS height assigned to the editor container. */
		height?: string;
		/** Additional CSS classes applied to the editor container. */
		class?: string;
		/** Whether editing is disabled while retaining editor navigation and selection. */
		readOnly?: boolean;
		/** Whether later value prop changes should replace the Monaco model contents. */
		syncValue?: boolean;
		/** Name of the database from `databaseSchema` to use as the active database. */
		database: string;
		/** Available Kusto databases and their tables/columns for IntelliSense. */
		databaseSchema: KustoDatabaseSchema;
		/** Connection string used to identify the active cluster in Monaco-Kusto. */
		clusterUrl?: string;
		/** Called by the editor's Shift+Enter command to execute the current query. */
		onexecute?: (side: DiffSide) => void;
		/** Called whenever the user changes the editor contents. */
		onvaluechange?: (value: string) => void;
		/** Called whenever the original side of a diff editor changes. */
		onoriginalvaluechange?: (value: string) => void;
		/** Reports which side of a diff editor most recently received focus. */
		onactivesidechange?: (side: DiffSide) => void;
		/** Reports the lazy Kusto language-service worker state to the parent workspace. */
		onlanguagestatuschange?: (status: 'idle' | 'loading' | 'ready') => void;
	};

	let {
		value = $bindable(''),
		originalValue,
		theme = 'vs',
		height = '320px',
		class: className = '',
		readOnly = false,
		syncValue = true,
		database,
		databaseSchema,
		clusterUrl = 'https://help.kusto.windows.net',
		onexecute,
		onvaluechange,
		onoriginalvaluechange,
		onactivesidechange,
		onlanguagestatuschange
	}: MonacoEditorProps = $props();

	let container = $state<HTMLDivElement | null>(null);
	let editor = $state<MonacoEditor | null>(null);
	let originalEditor = $state<MonacoEditor | null>(null);
	let diffEditor = $state<MonacoDiffEditor | null>(null);
	let model = $state<MonacoModel | null>(null);
	let originalModel = $state<MonacoModel | null>(null);
	let monaco = $state<MonacoApi | null>(null);
	let kusto = $state<KustoApi | null>(null);
	let changeDisposable = $state<MonacoDisposable | null>(null);
	let originalChangeDisposable = $state<MonacoDisposable | null>(null);
	let documentationHoverDisposable = $state<MonacoDisposable | null>(null);
	let findWidgetFocusGuardDisposable = $state<MonacoDisposable | null>(null);
	let intelliSenseActivationDisposable = $state<MonacoDisposable | null>(null);
	let originalIntelliSenseActivationDisposable = $state<MonacoDisposable | null>(null);
	let initializationError = $state<string | null>(null);
	let isLoading = $state(true);
	let syncingFromEditor = false;
	let schemaRequestId = 0;
	let isIntelliSenseActive = $state(false);
	const editorInstanceId = createEditorInstanceId();

	function createModelUri(monacoApi: MonacoApi, databaseName: string, role: 'editor' | 'original') {
		return monacoApi.Uri.parse(
			`inmemory://kite/${editorInstanceId}/${role}/${encodeURIComponent(clusterUrl)}/${encodeURIComponent(databaseName.toLowerCase())}.kql`
		);
	}

	async function applySchema(
		databaseName: string,
		schema = databaseSchema,
		targetClusterUrl = clusterUrl
	) {
		if (!monaco || !model || !kusto) return;

		const requestId = ++schemaRequestId;
		const targetModel = model;
		onlanguagestatuschange?.('loading');
		const workerAccessor = await kusto.getKustoWorker();
		const worker = await workerAccessor(targetModel.uri);
		if (requestId !== schemaRequestId || model !== targetModel) return;

		await worker.setSchema(createKustoSchema(schema, databaseName, targetClusterUrl));
		if (requestId === schemaRequestId && model === targetModel) onlanguagestatuschange?.('ready');
	}

	function applySchemaSafely(
		databaseName: string,
		schema = databaseSchema,
		targetClusterUrl = clusterUrl
	) {
		void applySchema(databaseName, schema, targetClusterUrl).catch((error) => {
			console.error('Failed to apply the Kusto database schema.', error);
		});
	}

	/**
	 * Monaco's language registration is cheap; the Kusto worker is not. Delay
	 * creating it until the editor receives focus, then install the latest schema
	 * before the user asks for completions or diagnostics.
	 */
	function activateIntelliSense() {
		if (isIntelliSenseActive) return;
		isIntelliSenseActive = true;
		const activeDatabase = getKustoDatabase(databaseSchema, database);
		applySchemaSafely(activeDatabase.name, databaseSchema, clusterUrl);
	}

	function bindModel(nextModel: MonacoModel) {
		changeDisposable?.dispose();
		changeDisposable = nextModel.onDidChangeContent(() => {
			syncingFromEditor = true;
			value = nextModel.getValue();
			onvaluechange?.(value);
			syncingFromEditor = false;
		});
	}

	function bindOriginalModel(nextModel: MonacoModel) {
		originalChangeDisposable?.dispose();
		originalChangeDisposable = nextModel.onDidChangeContent(() => {
			onoriginalvaluechange?.(nextModel.getValue());
		});
	}

	/**
	 * Monaco defers exposing a newly opened find widget until after focusing its
	 * input, and hides it before returning focus to the editor. Keep focus and
	 * aria-hidden synchronized across both transitions.
	 */
	function registerFindWidgetFocusGuard(host: HTMLElement, targetEditor: MonacoEditor) {
		const isInsideFindWidget = (target: EventTarget | null) =>
			target instanceof Element && target.closest('.find-widget') !== null;
		const isCloseButton = (target: EventTarget | null) =>
			target instanceof Element && target.closest('.find-widget .codicon-widget-close') !== null;

		const handleKeydown = (event: KeyboardEvent) => {
			const closesWithEscape = event.key === 'Escape' && isInsideFindWidget(event.target);
			const activatesCloseButton =
				isCloseButton(event.target) && (event.key === 'Enter' || event.key === ' ');

			if (closesWithEscape || activatesCloseButton) targetEditor.focus();
		};

		const handleClick = (event: MouseEvent) => {
			if (isCloseButton(event.target)) targetEditor.focus();
		};

		const handleFocusin = (event: FocusEvent) => {
			if (!(event.target instanceof Element)) return;

			const hiddenFindWidget = event.target.closest('.find-widget[aria-hidden="true"]');
			if (hiddenFindWidget) hiddenFindWidget.setAttribute('aria-hidden', 'false');
		};

		host.addEventListener('focusin', handleFocusin, true);
		host.addEventListener('keydown', handleKeydown, true);
		host.addEventListener('click', handleClick, true);

		return {
			dispose() {
				host.removeEventListener('focusin', handleFocusin, true);
				host.removeEventListener('keydown', handleKeydown, true);
				host.removeEventListener('click', handleClick, true);
			}
		};
	}

	/** Returns the current Kusto markers so query failures can include actionable local diagnostics. */
	export function getDiagnostics(): EditorDiagnostic[] {
		if (!monaco || !model) return [];

		return monaco.editor
			.getModelMarkers({ resource: model.uri })
			.filter((marker) => marker.severity >= monaco!.MarkerSeverity.Info)
			.map((marker) => ({
				message: marker.message,
				severity:
					marker.severity >= monaco!.MarkerSeverity.Error
						? 'error'
						: marker.severity >= monaco!.MarkerSeverity.Warning
							? 'warning'
							: 'info',
				line: marker.startLineNumber,
				column: marker.startColumn,
				code: marker.code === undefined ? undefined : String(marker.code)
			}));
	}

	onMount(() => {
		let disposed = false;
		let releaseKustoWorker: (() => void) | undefined;

		const initialize = async () => {
			if (!container) return;

			const runtime = await loadKustoRuntime();
			if (disposed || !container) return;

			monaco = runtime.monaco;
			kusto = runtime.kusto;
			releaseKustoWorker = retainKustoWorker(runtime.kusto);
			documentationHoverDisposable = registerDocumentationHoverProvider(runtime.monaco);

			const activeDatabase = getKustoDatabase(databaseSchema, database);
			const modelUri = createModelUri(runtime.monaco, activeDatabase.name, 'editor');
			const existingModel = runtime.monaco.editor.getModel(modelUri);
			const editorModel =
				existingModel ?? runtime.monaco.editor.createModel(value, KUSTO_LANGUAGE_ID, modelUri);
			if (existingModel && existingModel.getValue() !== value) editorModel.setValue(value);

			model = editorModel;
			const sharedEditorOptions = {
				theme,
				automaticLayout: true,
				fixedOverflowWidgets: true,
				minimap: { enabled: false },
				readOnly,
				suggest: { showInlineDetails: true },
				tabSize: 4,
				fontSize: 14,
				scrollBeyondLastLine: false,
				padding: { top: 16, bottom: 16 },
				wordWrap: 'on' as const
			};
			if (originalValue !== undefined) {
				const originalUri = createModelUri(runtime.monaco, activeDatabase.name, 'original');
				const existingOriginalModel = runtime.monaco.editor.getModel(originalUri);
				const nextOriginalModel =
					existingOriginalModel ??
					runtime.monaco.editor.createModel(originalValue, KUSTO_LANGUAGE_ID, originalUri);
				if (existingOriginalModel && existingOriginalModel.getValue() !== originalValue) {
					nextOriginalModel.setValue(originalValue);
				}
				originalModel = nextOriginalModel;
				diffEditor = runtime.monaco.editor.createDiffEditor(container, {
					...sharedEditorOptions,
					originalEditable: !readOnly,
					renderSideBySide: true
				});
				diffEditor.setModel({ original: nextOriginalModel, modified: editorModel });
				editor = diffEditor.getModifiedEditor();
				originalEditor = diffEditor.getOriginalEditor();
				originalIntelliSenseActivationDisposable = originalEditor.onDidFocusEditorText(() => {
					onactivesidechange?.('left');
					activateIntelliSense();
				});
				if (!readOnly) bindOriginalModel(nextOriginalModel);
			} else {
				editor = runtime.monaco.editor.create(container, {
					...sharedEditorOptions,
					model: editorModel
				});
			}
			editor.addCommand(
				runtime.monaco.KeyMod.Shift | runtime.monaco.KeyCode.Enter,
				() => {
					if (!readOnly) onexecute?.(originalEditor?.hasTextFocus() ? 'left' : 'right');
				},
				'editorTextFocus'
			);
			editor.addAction({
				id: 'kite.toggleWordWrap',
				label: 'Toggle Word Wrap',
				keybindings: [runtime.monaco.KeyMod.Alt | runtime.monaco.KeyCode.KeyZ],
				run: (targetEditor) => {
					const wordWrap = targetEditor.getOption(runtime.monaco.editor.EditorOption.wordWrap);
					targetEditor.updateOptions({ wordWrap: wordWrap === 'off' ? 'on' : 'off' });
				}
			});
			findWidgetFocusGuardDisposable = registerFindWidgetFocusGuard(container, editor);
			intelliSenseActivationDisposable = editor.onDidFocusEditorText(() => {
				onactivesidechange?.('right');
				activateIntelliSense();
			});

			if (!readOnly) bindModel(editorModel);
			isLoading = false;
		};

		void initialize().catch((error) => {
			isLoading = false;
			initializationError =
				error instanceof Error ? error.message : 'Failed to initialize Monaco editor';
			console.error(error);
		});

		return () => {
			disposed = true;
			schemaRequestId += 1;
			changeDisposable?.dispose();
			originalChangeDisposable?.dispose();
			documentationHoverDisposable?.dispose();
			findWidgetFocusGuardDisposable?.dispose();
			intelliSenseActivationDisposable?.dispose();
			originalIntelliSenseActivationDisposable?.dispose();
			if (container?.contains(document.activeElement)) editor?.focus();
			if (diffEditor) diffEditor.dispose();
			else editor?.dispose();
			model?.dispose();
			originalModel?.dispose();
			releaseKustoWorker?.();
		};
	});

	$effect(() => {
		if (
			syncValue &&
			originalValue === undefined &&
			model &&
			!syncingFromEditor &&
			model.getValue() !== value
		) {
			model.setValue(value);
		}
	});

	$effect(() => {
		editor?.updateOptions({ readOnly });
	});

	$effect(() => {
		monaco?.editor.setTheme(theme);
	});

	$effect(() => {
		if (!isIntelliSenseActive || !monaco || !editor || !model) return;

		const activeDatabase = getKustoDatabase(databaseSchema, database);
		applySchemaSafely(activeDatabase.name, databaseSchema, clusterUrl);
	});
</script>

{#if initializationError}
	<div
		class={cn(
			'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive',
			className
		)}
	>
		{initializationError}
	</div>
{:else}
	<div
		bind:this={container}
		class={cn(
			'relative min-w-0 max-w-full overflow-visible border bg-background',
			className
		)}
		style={`height: ${height};`}
	>
		{#if isLoading}
			<div
				class="absolute inset-0 z-10 grid place-items-center bg-background/80"
				aria-busy="true"
			>
				<Spinner class="size-7 text-muted-foreground" />
				<span class="sr-only">Loading Kusto editor</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	/*
	 * Monaco mounts button tooltips next to the editor root. The host must allow
	 * those context views to escape while the editor surface inherits its container shape.
	 */
	:global(.monaco-editor),
	:global(.monaco-editor .overflow-guard) {
		border-radius: inherit;
	}

	/*
	 * Compact command tooltips can wrap after Monaco calculates their position,
	 * making the taller tooltip overlap its trigger and repeatedly dismiss itself.
	 * Keep these labels on one line; rich editor hovers remain unaffected.
	 */
	:global(.monaco-editor ~ .context-view .monaco-hover.workbench-hover.compact .hover-contents) {
		white-space: nowrap !important;
	}

	:global(.monaco-editor .rendered-markdown h1),
	:global(.monaco-editor .rendered-markdown h2),
	:global(.monaco-editor .rendered-markdown h3) {
		font-weight: 700;
		line-height: 1.3;
	}

	:global(.monaco-editor .rendered-markdown h1) {
		font-size: 1.25em;
		margin: 1em 0 0.5em;
	}

	:global(.monaco-editor .rendered-markdown h2) {
		font-size: 1.1em;
		margin: 0.9em 0 0.4em;
	}

	:global(.monaco-editor .rendered-markdown h3) {
		font-size: 1em;
		margin: 0.8em 0 0.35em;
	}
</style>
