// @ts-nocheck
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import * as languageFeatures from '@kusto/monaco-kusto/release/esm/languageFeatures';
import { LANGUAGE_ID } from '@kusto/monaco-kusto/release/esm/globals';
import { semanticTokensProviderRegistrarCreator } from '@kusto/monaco-kusto/release/esm/syntaxHighlighting/semanticTokensProviderRegistrar';
import { kustoLanguageDefinition } from '@kusto/monaco-kusto/release/esm/syntaxHighlighting/kustoMonarchLanguageDefinition';

import { KustoWorkerManager } from './monaco-kusto-worker-manager';

let kustoWorker;
let workerManager: KustoWorkerManager | undefined;
let resolveWorker: (accessor: unknown) => void;
const workerPromise = new Promise((resolve) => {
	resolveWorker = resolve;
});

export function setupMode(defaults, monacoInstance, onSchemaUpdateCompleteEmitter) {
	const onSchemaChange = new monaco.Emitter();
	const semanticTokensProviderRegistrar = semanticTokensProviderRegistrarCreator((uri) => {
		onSchemaUpdateCompleteEmitter?.fire({ uri });
	});
	workerManager?.dispose();
	const client = new KustoWorkerManager(monacoInstance, defaults);
	workerManager = client;

	const workerAccessor = (...resources) =>
		client.getLanguageServiceWorker(...resources).then((worker) => {
			const augmentedSetSchema = (schema) =>
				client.trackRequest(
					worker.setSchema(schema).then(() => {
						onSchemaChange.fire(schema);
						semanticTokensProviderRegistrar(monacoInstance, workerAccessor);
					})
				);
			const overrides = {
				setSchema: augmentedSetSchema,
				setSchemaFromShowSchema: (
					schema,
					connection,
					database,
					globalScalarParameters,
					globalTabularParameters
				) =>
					client.trackRequest(
						worker.normalizeSchema(schema, connection, database).then((normalizedSchema) => {
							if (globalScalarParameters || globalTabularParameters) {
								normalizedSchema = {
									...normalizedSchema,
									globalScalarParameters,
									globalTabularParameters
								};
							}
							return augmentedSetSchema(normalizedSchema);
						})
					)
			};
			const target = Object.assign(Object.create(worker), overrides);
			return new Proxy(target, {
				get(target, property, receiver) {
					const value = Reflect.get(target, property, receiver);
					if (typeof value !== 'function') return value;
					return (...args) => client.trackRequest(Promise.resolve(value.apply(target, args)));
				}
			});
		});

	monacoInstance.languages.registerCompletionItemProvider(
		LANGUAGE_ID,
		new languageFeatures.CompletionAdapter(workerAccessor, defaults.languageSettings)
	);
	monacoInstance.languages.setMonarchTokensProvider(LANGUAGE_ID, kustoLanguageDefinition);
	new languageFeatures.DiagnosticsAdapter(
		monacoInstance,
		LANGUAGE_ID,
		workerAccessor,
		defaults,
		onSchemaChange.event
	);
	monacoInstance.languages.registerDocumentRangeFormattingEditProvider(
		LANGUAGE_ID,
		new languageFeatures.FormatAdapter(workerAccessor)
	);
	monacoInstance.languages.registerFoldingRangeProvider(
		LANGUAGE_ID,
		new languageFeatures.FoldingAdapter(workerAccessor)
	);
	monacoInstance.languages.registerDefinitionProvider(
		LANGUAGE_ID,
		new languageFeatures.DefinitionAdapter(workerAccessor)
	);
	monacoInstance.languages.registerRenameProvider(
		LANGUAGE_ID,
		new languageFeatures.RenameAdapter(workerAccessor)
	);
	monacoInstance.languages.registerReferenceProvider(
		LANGUAGE_ID,
		new languageFeatures.ReferenceAdapter(workerAccessor)
	);
	if (defaults.languageSettings.enableHover) {
		monacoInstance.languages.registerHoverProvider(
			LANGUAGE_ID,
			new languageFeatures.HoverAdapter(workerAccessor)
		);
	}
	monacoInstance.languages.registerDocumentFormattingEditProvider(
		LANGUAGE_ID,
		new languageFeatures.DocumentFormatAdapter(workerAccessor)
	);
	kustoWorker = workerAccessor;
	resolveWorker(workerAccessor);
	monacoInstance.languages.setLanguageConfiguration(LANGUAGE_ID, languageConfiguration);
}

export function getKustoWorker() {
	return workerPromise.then(() => kustoWorker);
}

/** Releases only the worker. Monaco providers remain registered and recreate it on demand. */
export function disposeKustoWorker() {
	return workerManager?.disposeWorker() ?? Promise.resolve();
}

export function hasKustoWorker() {
	return Boolean(workerManager);
}

const languageConfiguration = {
	folding: { offSide: false, markers: { start: /^\s*[\r\n]/gm, end: /^\s*[\r\n]/gm } },
	comments: { lineComment: '//', blockComment: null },
	autoClosingPairs: [
		{ open: '{', close: '}' },
		{ open: '[', close: ']' },
		{ open: '(', close: ')' },
		{ open: "'", close: "'", notIn: ['string', 'comment'] },
		{ open: '"', close: '"', notIn: ['string', 'comment'] }
	],
	brackets: [
		['[', ']'],
		['{', '}'],
		['(', ')']
	],
	colorizedBracketPairs: [],
	wordPattern: /[a-zA-Z0-9\-_]+/g
};
