import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import cloudflareAdapter from '@sveltejs/adapter-cloudflare';
import staticAdapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const BUILD_TARGETS = ['cloudflare', 'container'] as const;
type BuildTarget = (typeof BUILD_TARGETS)[number];

function getBuildTarget(): BuildTarget {
	const target = process.env.KITE_BUILD_TARGET ?? 'cloudflare';
	if ((BUILD_TARGETS as readonly string[]).includes(target)) return target as BuildTarget;

	throw new Error(
		`Unsupported KITE_BUILD_TARGET ${JSON.stringify(target)}. Use one of: ${BUILD_TARGETS.join(', ')}.`
	);
}

const buildTarget = getBuildTarget();
const kitAdapter =
	buildTarget === 'container'
		? staticAdapter({
				pages: 'build',
				assets: 'build'
			})
		: cloudflareAdapter();

const monacoKustoContributionPath =
	'/node_modules/@kusto/monaco-kusto/release/esm/monaco.contribution.js';

/**
 * Monaco-Kusto imports its mode relatively, so a normal package alias cannot
 * replace its worker manager. Redirect only that private import to Kite's
 * lifecycle-aware implementation; all other package code remains upstream.
 */
const monacoKustoLifecycleMode = {
	name: 'kite-monaco-kusto-lifecycle-mode',
	enforce: 'pre' as const,
	resolveId(source: string, importer?: string) {
		if (source === './kustoMode' && importer?.includes(monacoKustoContributionPath)) {
			return resolve('src/lib/kusto/monaco-kusto-mode.ts');
		}
		return null;
	}
};

export default defineConfig({
	resolve: {
		dedupe: ['monaco-editor'],
		alias: [
			{
				find: /^@kusto\/monaco-kusto$/,
				replacement: resolve('src/lib/kusto/monaco-kusto.ts')
			}
		]
	},
	plugins: [
		monacoKustoLifecycleMode,
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Cloudflare remains the default deployment target. Container builds emit
			// static files for the web server added with the Docker target.
			adapter: kitAdapter
		}),
		// A browser has no filesystem; Bridge.js only needs this import to resolve.
		nodePolyfills({
			exclude: ['module'],
			overrides: {
				fs: 'node-stdlib-browser/mock/empty'
			}
		})
	],
	// The browser-only DuckDB client is emitted as an orphaned SSR dynamic chunk.
	// Inline its package so Wrangler can bundle preview artifacts without node_modules.
	ssr: {
		noExternal: ['@duckdb/duckdb-wasm']
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	},
	server: {
		watch: {
			ignored: ['**/README.md', 'docs/**']
		}
	}
});
