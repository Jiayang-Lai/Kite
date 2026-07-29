/**
 * Public Monaco-Kusto entry with Kite's lifecycle-aware worker mode.
 * The upstream contribution remains responsible for language registration,
 * themes, and the public API; Vite redirects its private mode import below.
 */
export * from '@kusto/monaco-kusto/release/esm/monaco.contribution.js';
export { disposeKustoWorker, hasKustoWorker } from './monaco-kusto-mode';
