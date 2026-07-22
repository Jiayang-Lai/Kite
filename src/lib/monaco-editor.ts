/**
 * The Monaco standalone API plus the only editor contributions Kite needs.
 *
 * The package root imports every VS Code contribution. Several of those expect
 * workbench-only services (CodeLens cache, inlay-hints cache, tree DnD, and action
 * widgets), which do not exist in a standalone Monaco editor. Loading the narrow
 * set below keeps hover and Kusto's suggestion UI available without registering
 * unsupported workbench features.
 */
// Register Monaco's find/replace widget and its built-in shortcuts.
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js';
import 'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js';
// Register multi-cursor actions, including Ctrl/Cmd+D to select the next match.
import 'monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js';
// Monaco-Kusto registers document and range formatting providers when its mode
// starts. This contribution supplies the standalone editor actions that invoke
// those providers, including context-menu entries and keyboard shortcuts.
import 'monaco-editor/esm/vs/editor/contrib/format/browser/formatActions.js';
// `suggestController` imports and registers `suggestMemory` itself. Importing it
// separately here can give Vite a second copy of Monaco's service singleton.
import 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js';

// Keep this specifier identical to Monaco-Kusto's own contribution import.
// Vite then gives both packages the same optimized editor API instance in dev.
export * from 'monaco-editor/esm/vs/editor/editor.api';
