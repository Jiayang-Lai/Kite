import { mkdir, readFile, writeFile } from 'node:fs/promises';

import {
	buildContentSecurityPolicy,
	collectBuildScriptHashes,
	CSP_HEADER_NAME
} from './lib/content-security-policy.mjs';

// Runs after `vite build`. SvelteKit's per-page startup scripts change with every build, so the
// policy's script hashes must be computed from the emitted HTML rather than kept in source.
const target = process.env.KITE_BUILD_TARGET ?? 'cloudflare';
const outputDirectory = { cloudflare: '.svelte-kit/cloudflare', container: 'build' }[target];
if (!outputDirectory) throw new Error(`Unsupported KITE_BUILD_TARGET ${JSON.stringify(target)}.`);

const metadataDirectory = '.svelte-kit/kite-csp';
const hashes = await collectBuildScriptHashes(outputDirectory);
const policy = buildContentSecurityPolicy(hashes);

await mkdir(metadataDirectory, { recursive: true });
// Read by `vite preview` so local previews and end-to-end tests run under the deployed policy.
await writeFile(
	`${metadataDirectory}/headers.json`,
	`${JSON.stringify({ [CSP_HEADER_NAME]: policy }, null, '\t')}\n`
);

if (target === 'cloudflare') {
	await addCloudflareHeader(`${outputDirectory}/_headers`, `  ${CSP_HEADER_NAME}: ${policy}`);
} else {
	// Copied by the Dockerfile and included from docker/security-headers.conf.
	await writeFile(
		`${metadataDirectory}/nginx.conf`,
		`add_header ${CSP_HEADER_NAME} "${policy}" always;\n`
	);
}

console.log(`${CSP_HEADER_NAME}: ${hashes.length} inline script hashes for the ${target} build.`);

/** Adds the policy to the `/*` rule from the project-root _headers file copied by the adapter. */
async function addCloudflareHeader(path, headerLine) {
	// Replace a policy from an earlier run so the script can be re-run on the same output.
	const lines = (await readFile(path, 'utf8'))
		.split('\n')
		.filter((line) => !line.trimStart().startsWith(`${CSP_HEADER_NAME}:`));
	const ruleIndex = lines.findIndex((line) => line.trim() === '/*');
	if (ruleIndex === -1) throw new Error(`${path} has no "/*" rule for security headers.`);
	lines.splice(ruleIndex + 1, 0, headerLine);
	await writeFile(path, lines.join('\n'));
}
