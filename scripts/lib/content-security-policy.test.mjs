import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
	buildContentSecurityPolicy,
	collectInlineScriptHashes,
	hashInlineScript
} from './content-security-policy.mjs';

describe('content security policy', () => {
	it('hashes the exact inline script text', () => {
		const content = '\n\tconsole.log("kite");\n';
		const digest = createHash('sha256').update(content).digest('base64');
		expect(hashInlineScript(content)).toBe(`'sha256-${digest}'`);
	});

	it('collects inline scripts but not external or empty scripts', () => {
		const html =
			'<script>one()</script><script type="module">two()</script>' +
			'<script src="/app.js"></script><script>  </script><script>one()</script>';
		expect([...collectInlineScriptHashes(html)]).toEqual([
			hashInlineScript('one()'),
			hashInlineScript('two()')
		]);
	});

	it('adds script hashes only to script-src', () => {
		const policy = buildContentSecurityPolicy(["'sha256-abc'"]);
		const directives = Object.fromEntries(
			policy.split('; ').map((directive) => {
				const [name, ...sources] = directive.split(' ');
				return [name, sources];
			})
		);
		expect(directives['script-src']).toEqual([
			"'self'",
			"'wasm-unsafe-eval'",
			"'report-sample'",
			"'sha256-abc'"
		]);
		expect(policy.match(/sha256-abc/g)).toHaveLength(1);
		expect(directives['object-src']).toEqual(["'none'"]);
		expect(directives['frame-ancestors']).toEqual(["'self'"]);
	});
});
