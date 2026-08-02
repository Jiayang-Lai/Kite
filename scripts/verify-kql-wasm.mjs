import { access, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = resolve(projectRoot, 'static/kql-wasm');
const frameworkRoot = resolve(artifactRoot, '_framework');

await access(resolve(frameworkRoot, 'dotnet.js'));
const files = await listFiles(frameworkRoot);
if (!files.some((file) => /^KqlWasmBridge\..+\.wasm$/.test(file))) {
	throw new Error('KQL translator framework is missing the KqlWasmBridge assembly.');
}
if (!files.some((file) => /^dotnet\.native\..+\.wasm$/.test(file))) {
	throw new Error('KQL translator framework is missing the .NET native runtime.');
}

console.log('Verified KQL translator WebAssembly.');

async function listFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		if (entry.isFile()) {
			files.push(entry.name);
			continue;
		}
		if (entry.isDirectory()) {
			for (const child of await listFiles(resolve(directory, entry.name))) {
				files.push(`${entry.name}/${child}`);
			}
		}
	}

	return files;
}
