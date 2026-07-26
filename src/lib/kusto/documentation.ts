import { KUSTO_DOCUMENTATION_PATHS } from '$lib/generated/kusto-documentation-index';

import type { KustoApi, MonacoApi } from './runtime';

/**
 * Documentation integration for Monaco-Kusto completion and hover UI.
 *
 * Monaco-Kusto provides language-service results; Kite augments those results with
 * the local Markdown mirror generated from Microsoft Learn. The module keeps this
 * browser-only concern outside the editor component and deliberately does not use
 * the legacy AMD `window.Kusto` global. Requests are deduplicated by asset URL and
 * limited in parallelism so opening a broad completion list cannot flood the docs
 * endpoint.
 */
type CompletionDocumentation = string | { value?: string } | undefined;
type CompletionItemShape = {
	label?: string;
	detail?: string;
	documentation?: CompletionDocumentation;
};
type CompletionListShape = { items: CompletionItemShape[] };

const KUSTO_DOCS_SITE_BASE_URL = 'https://learn.microsoft.com/en-us/kusto/query';
const MAX_CONCURRENT_REQUESTS = 10;
const requests = new Map<
	string,
	Promise<{ detail: string; documentation?: { value: string } } | null>
>();
let activeRequests = 0;
const pendingRequests: Array<() => void> = [];

/** Resolves a completion label, including a function call such as `count()`, to its docs slug. */
function getDocumentationPath(label: string) {
	const normalizedLabel = label.trim().toLowerCase();
	const functionName = normalizedLabel.replace(/\(.*$/, '');
	const paths: Record<string, string> = KUSTO_DOCUMENTATION_PATHS;
	return paths[normalizedLabel] ?? paths[functionName] ?? '';
}

function getOfficialDocsUrl(label: string) {
	const path = getDocumentationPath(label);
	return path ? `${KUSTO_DOCS_SITE_BASE_URL}/${path}` : KUSTO_DOCS_SITE_BASE_URL;
}

function getDocumentationText(documentation: CompletionDocumentation) {
	const value = typeof documentation === 'string' ? documentation : documentation?.value;
	return (value ?? '')
		.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/#+\s*/g, '')
		.replace(/\r/g, '')
		.trim();
}

/** Produces a compact, plain-text detail line when a completion lacks one. */
function getDocumentationExcerpt(documentation: CompletionDocumentation) {
	const value = typeof documentation === 'string' ? documentation : documentation?.value;
	const text = getDocumentationText({
		value: (value ?? '')
			.split('\n')
			.filter((line) => !/^\s{0,3}#{1,6}\s+/.test(line) && !/^\s{0,3}>/.test(line))
			.join('\n')
	});
	const firstParagraph = text
		.split('\n')
		.map((line) => line.trim())
		.find(Boolean);

	return firstParagraph && firstParagraph.length > 96
		? `${firstParagraph.slice(0, 93).trimEnd()}...`
		: (firstParagraph ?? '');
}

function removeMarkdownFrontMatter(markdown: string) {
	return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

/** Queues documentation network work while enforcing the global concurrency limit. */
async function queueRequest<T>(request: () => Promise<T>) {
	if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
		await new Promise<void>((resolve) => pendingRequests.push(resolve));
	}

	activeRequests += 1;
	try {
		return await request();
	} finally {
		activeRequests -= 1;
		pendingRequests.shift()?.();
	}
}

/**
 * Retrieves a topic's local Markdown asset once and returns Monaco-ready detail
 * and Markdown values. Missing documents and failed network requests intentionally
 * resolve to `null`: documentation must never block a language-service result.
 */
async function getTopicDocumentation(label: string) {
	const path = getDocumentationPath(label);
	if (!path) {
		return null;
	}

	const assetUrl = `/kusto-docs/${path}.md`;
	let request = requests.get(assetUrl);
	if (!request) {
		request = queueRequest(() => fetch(assetUrl))
			.then(async (response) => {
				if (!response.ok) return null;
				const markdown = removeMarkdownFrontMatter(await response.text());
				if (!markdown) return null;
				return {
					detail: getDocumentationExcerpt({ value: markdown }),
					documentation: {
						value: `**${label} [(view online)](${getOfficialDocsUrl(label)})**\n\n${markdown}`
					}
				};
			})
			.catch(() => null);
		requests.set(assetUrl, request);
	}

	return request;
}

function buildFallbackDocumentation(label: string, detail: string) {
	return detail
		? { value: `**${label} [(view online)](${getOfficialDocsUrl(label)})**\n\n${detail}` }
		: undefined;
}

/** Adds official documentation only to incomplete Monaco-Kusto completion entries. */
async function enrichCompletionItems(list: CompletionListShape) {
	return {
		...list,
		items: await Promise.all(
			list.items.map(async (item) => {
				const label = typeof item.label === 'string' ? item.label : '';
				if (item.detail && item.documentation) return item;
				const topic = label ? await getTopicDocumentation(label) : null;
				const detail = item.detail || topic?.detail || getDocumentationExcerpt(item.documentation);
				const documentation =
					item.documentation ?? topic?.documentation ?? buildFallbackDocumentation(label, detail);
				return detail || documentation ? { ...item, detail, documentation } : item;
			})
		)
	};
}

/**
 * Installs the Monaco-Kusto completion callback and official Learn URL settings.
 *
 * This is called by the runtime singleton, not by individual editor instances, so
 * every Kusto model gets identical completion documentation without resetting the
 * package defaults as editors mount and unmount.
 */
export function configureKustoDocumentation(kusto: KustoApi) {
	kusto.kustoDefaults.setLanguageSettings({
		...kusto.kustoDefaults.languageSettings,
		documentationBaseUrl: KUSTO_DOCS_SITE_BASE_URL,
		documentationSuffix: '',
		onDidProvideCompletionItems: enrichCompletionItems
	} as unknown as Parameters<typeof kusto.kustoDefaults.setLanguageSettings>[0]);
}

/**
 * Registers a Kusto hover provider backed by the local documentation mirror.
 *
 * The caller owns the returned disposable. This keeps hover registration scoped to
 * an editor component's lifecycle and prevents an editor that has been removed
 * from leaving an extra provider behind.
 */
export function registerDocumentationHoverProvider(monaco: MonacoApi) {
	return monaco.languages.registerHoverProvider('kusto', {
		async provideHover(model, position) {
			const word = model.getWordAtPosition(position);
			if (!word) return null;
			const topic = await getTopicDocumentation(word.word);
			const documentation =
				topic?.documentation ?? buildFallbackDocumentation(word.word, topic?.detail ?? '');
			if (!documentation?.value) return null;

			return {
				range: new monaco.Range(
					position.lineNumber,
					word.startColumn,
					position.lineNumber,
					word.endColumn
				),
				contents: [documentation]
			};
		}
	});
}
