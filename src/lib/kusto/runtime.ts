import { configureKustoDocumentation } from './documentation';

/**
 * Browser-only Monaco-Kusto runtime bootstrap.
 *
 * Monaco-Kusto's ESM contribution registers the `kusto` language and lazily loads
 * its mode when a Kusto model is created. This module supplies the one piece the
 * contribution deliberately leaves to its host application: worker routing.
 * Kusto requests must go to the Kusto worker, while every other Monaco language
 * uses Monaco's editor worker.
 *
 * The result is cached on `window` rather than at module scope so multiple editor
 * components, including ones loaded from separate client chunks, share one Monaco
 * API instance, language registration, and worker configuration.
 */
export type MonacoApi = typeof import('monaco-editor/esm/vs/editor/editor.api');
export type KustoApi = typeof import('@kusto/monaco-kusto') & {
	disposeKustoWorker(): Promise<void>;
	hasKustoWorker(): boolean;
};

type MonacoEnvironment = { getWorker: (_moduleId: string, label: string) => Worker };
type MonacoWindow = Window &
	typeof globalThis & {
		MonacoEnvironment?: MonacoEnvironment;
		__kiteMonacoEsmPromise?: Promise<{ monaco: MonacoApi; kusto: KustoApi }>;
	};

/**
 * Loads and configures Monaco and Monaco-Kusto exactly once per browser window.
 *
 * Call this only from client-side lifecycle code. The returned promise resolves
 * after the worker constructors are installed, the Kusto contribution is loaded,
 * and completion documentation enrichment is configured. Consumers should create
 * models only after awaiting it so Kusto's `onLanguage` handler can initialize its
 * language features normally.
 */
export async function loadKustoRuntime() {
	const browserWindow = window as MonacoWindow;
	if (browserWindow.__kiteMonacoEsmPromise) return browserWindow.__kiteMonacoEsmPromise;

	browserWindow.__kiteMonacoEsmPromise = (async () => {
		const [{ default: EditorWorker }, { default: KustoWorker }] = await Promise.all([
			import('monaco-editor/esm/vs/editor/editor.worker?worker'),
			import('$lib/workers/kusto.worker?worker')
		]);

		browserWindow.MonacoEnvironment = {
			getWorker(_moduleId, label) {
				return label === 'kusto' ? new KustoWorker() : new EditorWorker();
			}
		};

		// This must be one ordered ESM import. Monaco's suggestion contribution
		// registers ISuggestMemories as a standalone service during module
		// evaluation, before the first call to `monaco.editor.create`.
		const { monaco, kusto: importedKusto } = await import('$lib/kusto/monaco-integration');
		const kusto = importedKusto as KustoApi;
		configureKustoDocumentation(kusto);
		return { monaco, kusto };
	})();

	return browserWindow.__kiteMonacoEsmPromise!;
}
