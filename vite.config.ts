import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
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

/**
 * Mirrors the deployed CSP in `vite preview`, including end-to-end runs. The headers are generated
 * by scripts/generate-csp-headers.mjs. Vite's `preview.headers` only reaches its static file
 * server, not prerendered pages served by SvelteKit, so set them on every response instead.
 */
function previewSecurityHeaders(): Plugin {
	return {
		name: 'kite-preview-security-headers',
		configurePreviewServer(server) {
			const path = '.svelte-kit/kite-csp/headers.json';
			if (!existsSync(path)) return;
			const headers: Record<string, string> = JSON.parse(readFileSync(path, 'utf8'));
			const reportPath = '/__kite/csp-reports';
			const reports: unknown[] = [];
			// Preview-only report collection. Browsers deliver worker violations here too, which
			// never reach the page's console or securitypolicyviolation event.
			for (const name of Object.keys(headers)) {
				if (/content-security-policy/i.test(name)) headers[name] += `; report-uri ${reportPath}`;
			}
			server.middlewares.use(reportPath, (request, response) => {
				if (request.method === 'POST') {
					let body = '';
					request.on('data', (chunk) => (body += chunk));
					request.on('end', () => {
						try {
							reports.push(JSON.parse(body));
						} catch {
							reports.push(body);
						}
						response.statusCode = 204;
						response.end();
					});
					return;
				}
				response.setHeader('content-type', 'application/json');
				response.end(JSON.stringify(reports));
				if (request.method === 'DELETE') reports.length = 0;
			});
			server.middlewares.use((_request, response, next) => {
				for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
				next();
			});
		}
	};
}
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
				find: '#kite-duckdb-bundles',
				replacement: resolve(
					buildTarget === 'container'
						? 'src/lib/duckdb/duckdb-bundles.local.ts'
						: 'src/lib/duckdb/duckdb-bundles.cdn.ts'
				)
			},
			{
				find: /^@kusto\/monaco-kusto$/,
				replacement: resolve('src/lib/kusto/monaco-kusto.ts')
			}
		]
	},
	plugins: [
		monacoKustoLifecycleMode,
		tailwindcss(),
		previewSecurityHeaders(),
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
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov', 'json-summary'],
			reportsDirectory: 'coverage',
			include: ['src/**/*.{js,ts,svelte}'],
			exclude: [
				'src/**/*.d.ts',
				'src/**/*.{test,spec}.{js,ts}',
				'src/lib/generated/**',
				'src/lib/components/ui/**'
			],
			thresholds: {
				statements: 60,
				branches: 60,
				functions: 60,
				lines: 60,
				'src/lib/!(components)/**/*.{js,ts,svelte}': {
					statements: 71,
					branches: 65,
					functions: 74,
					lines: 75
				}
			}
		},
		projects: [
			{
				extends: './vite.config.ts',
				// Browser tests run real DuckDB-WASM. Serve it from the package rather than the
				// Cloudflare build's CDN, so tests never reach the network.
				resolve: {
					alias: [
						{
							find: '#kite-duckdb-bundles',
							replacement: resolve('src/lib/duckdb/duckdb-bundles.local.ts')
						}
					]
				},
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
			},

			// Build and release scripts run on plain Node, so their tests do not load the app's Vite
			// config, whose browser polyfills replace modules such as `fs` and `crypto`.
			{
				test: {
					name: 'scripts',
					environment: 'node',
					expect: { requireAssertions: true },
					include: ['scripts/**/*.{test,spec}.{js,mjs,ts}']
				}
			}
		]
	},
	server: {
		// Loopback IPv4 only: reachable by the dev container's port forwarder without exposing the LAN.
		host: '127.0.0.1',
		watch: {
			ignored: ['**/README.md', 'docs/**']
		}
	}
});
