import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureKustoDocumentation, registerDocumentationHoverProvider } from './documentation';

beforeEach(() => vi.restoreAllMocks());

describe('Kusto documentation integration', () => {
	it('configures completion enrichment and preserves complete upstream entries', async () => {
		const setLanguageSettings = vi.fn();
		configureKustoDocumentation({
			kustoDefaults: {
				languageSettings: { existing: true },
				setLanguageSettings
			}
		} as never);
		const settings = setLanguageSettings.mock.calls[0][0];
		expect(settings).toMatchObject({
			existing: true,
			documentationBaseUrl: 'https://learn.microsoft.com/en-us/kusto/query',
			documentationSuffix: ''
		});

		const existing = { label: 'existing', detail: 'Already described', documentation: 'Docs' };
		const enriched = await settings.onDidProvideCompletionItems({ items: [existing] });
		expect(enriched.items[0]).toBe(existing);
	});

	it('loads, deduplicates, and cleans local Markdown for completion items', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('---\ntitle: Count\n---\n# Count\n\nCounts **matching** rows.', {
				status: 200
			})
		);
		const setLanguageSettings = vi.fn();
		configureKustoDocumentation({
			kustoDefaults: { languageSettings: {}, setLanguageSettings }
		} as never);
		const enrich = setLanguageSettings.mock.calls[0][0].onDidProvideCompletionItems;

		const enriched = await enrich({ items: [{ label: 'count()' }, { label: 'count' }] });

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledWith('/kusto-docs/count-aggregation-function.md');
		expect(enriched.items[0].detail).toBe('Counts **matching** rows.');
		expect(enriched.items[0].documentation.value).toContain('[(view online)]');
		expect(enriched.items[0].documentation.value).not.toContain('title: Count');
	});

	it('uses existing detail as fallback documentation for unknown topics', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch');
		const setLanguageSettings = vi.fn();
		configureKustoDocumentation({
			kustoDefaults: { languageSettings: {}, setLanguageSettings }
		} as never);
		const enrich = setLanguageSettings.mock.calls[0][0].onDidProvideCompletionItems;

		const enriched = await enrich({ items: [{ label: 'kite_unknown', detail: 'Local detail' }] });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(enriched.items[0].documentation.value).toContain('Local detail');
	});

	it('registers a hover provider with the documented word range', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('Explains how the where operator filters rows.', { status: 200 })
		);
		const disposable = { dispose: vi.fn() };
		const registerHoverProvider = vi.fn((_language: string, _provider: never) => disposable);
		class Range {
			constructor(
				readonly startLineNumber: number,
				readonly startColumn: number,
				readonly endLineNumber: number,
				readonly endColumn: number
			) {}
		}
		const returned = registerDocumentationHoverProvider({
			languages: { registerHoverProvider },
			Range
		} as never);
		const provider = registerHoverProvider.mock.calls[0][1] as unknown as {
			provideHover: (...args: any[]) => Promise<any>;
		};
		const hover = await provider.provideHover(
			{ getWordAtPosition: () => ({ word: 'where', startColumn: 4, endColumn: 9 }) },
			{ lineNumber: 3 }
		);

		expect(returned).toBe(disposable);
		expect(registerHoverProvider).toHaveBeenCalledWith('kusto', expect.any(Object));
		expect(hover.range).toEqual(new Range(3, 4, 3, 9));
		expect(hover.contents[0].value).toContain('where operator');
	});

	it('returns no hover when there is no word or documentation fetch fails', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'));
		const registerHoverProvider = vi.fn((_language: string, _provider: never) => ({
			dispose: vi.fn()
		}));
		registerDocumentationHoverProvider({
			languages: { registerHoverProvider },
			Range: class {}
		} as never);
		const provider = registerHoverProvider.mock.calls[0][1] as unknown as {
			provideHover: (...args: any[]) => Promise<any>;
		};

		await expect(
			provider.provideHover({ getWordAtPosition: () => undefined }, { lineNumber: 1 })
		).resolves.toBeNull();
		await expect(
			provider.provideHover(
				{ getWordAtPosition: () => ({ word: 'summarize', startColumn: 1, endColumn: 10 }) },
				{ lineNumber: 1 }
			)
		).resolves.toBeNull();
	});
});
