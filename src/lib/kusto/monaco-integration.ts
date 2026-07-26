/**
 * Ordered ESM entry for the Monaco-Kusto editor integration.
 *
 * Monaco's standalone service container collects registrations from a
 * module-local registry when the first editor is created. In particular,
 * `suggestMemory` registers `ISuggestMemories`, which `SuggestController`
 * requires. The Kusto package imports Monaco's public API, while Kite adds the
 * small set of standalone contributions it uses in `$lib/monaco-editor`.
 *
 * Keep these imports in one ESM entry and in this order. Loading them through
 * independent dynamic imports leaves their evaluation and Vite's dependency
 * optimization order unconstrained; that can result in the suggestion
 * controller and the standalone editor observing different service registries.
 * Consumers must import this module before calling `monaco.editor.create`.
 */
import * as monaco from '$lib/monaco-editor';
import * as kusto from '@kusto/monaco-kusto';

export { kusto, monaco };
