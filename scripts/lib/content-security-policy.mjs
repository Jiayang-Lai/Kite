import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Kite's Content Security Policy, delivered as Content-Security-Policy-Report-Only until the
 * end-to-end suite has proven it does not block supported workflows.
 *
 * connect-src stays open because Kusto clusters, remote ingestion files, Log Analytics, and the
 * Cloudflare build's DuckDB runtime are all user- or deployment-selected endpoints.
 */
export const CSP_HEADER_NAME = 'Content-Security-Policy-Report-Only';

const BASE_DIRECTIVES = {
	'default-src': ["'self'"],
	// DuckDB-WASM and the .NET KQL translator compile WebAssembly at runtime. 'report-sample'
	// includes the first 40 characters of blocked code in reports, which identifies the source.
	'script-src': ["'self'", "'wasm-unsafe-eval'", "'report-sample'"],
	// Sidebar style attributes and Monaco's injected <style> elements.
	'style-src': ["'self'", "'unsafe-inline'"],
	'img-src': ["'self'", 'data:', 'blob:'],
	'font-src': ["'self'", 'data:'],
	'connect-src': ["'self'", 'https:', 'http:'],
	'worker-src': ["'self'"],
	// MSAL may renew tokens through a hidden Entra iframe.
	'frame-src': ['https://login.microsoftonline.com'],
	'object-src': ["'none'"],
	'base-uri': ["'self'"],
	'form-action': ["'self'"],
	'frame-ancestors': ["'self'"]
};

const INLINE_SCRIPT_PATTERN = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/** Returns the CSP source expression for one inline script body. */
export function hashInlineScript(content) {
	return `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`;
}

/** Collects hashes for every non-empty inline script in an HTML document. */
export function collectInlineScriptHashes(html) {
	const hashes = new Set();
	for (const [, content] of html.matchAll(INLINE_SCRIPT_PATTERN)) {
		if (content.trim()) hashes.add(hashInlineScript(content));
	}
	return hashes;
}

/** Collects inline script hashes from every prerendered page below a build directory. */
export async function collectBuildScriptHashes(directory) {
	const hashes = new Set();
	for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
		const html = await readFile(join(entry.parentPath, entry.name), 'utf8');
		for (const hash of collectInlineScriptHashes(html)) hashes.add(hash);
	}
	return [...hashes].sort();
}

/** Serializes the policy with the supplied inline script hashes. */
export function buildContentSecurityPolicy(scriptHashes = []) {
	return Object.entries(BASE_DIRECTIVES)
		.map(([directive, sources]) =>
			[directive, ...sources, ...(directive === 'script-src' ? scriptHashes : [])].join(' ')
		)
		.join('; ');
}
