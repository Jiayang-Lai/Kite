import { access, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = resolve(projectRoot, 'static/kql-wasm');
const frameworkRoot = resolve(artifactRoot, '_framework');
const manifestPath = resolve(artifactRoot, 'manifest.json');

await access(resolve(frameworkRoot, 'dotnet.js'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (manifest?.schemaVersion !== 1) {
	throw new Error('KQL translator manifest has an unsupported schema version.');
}
if (!/^[0-9a-f]{40}$/i.test(manifest?.translator?.commit ?? '')) {
	throw new Error('KQL translator manifest is missing a valid source commit.');
}
if (!/^[0-9a-f]{64}$/i.test(manifest?.frameworkSha256 ?? '')) {
	throw new Error('KQL translator manifest is missing a valid framework checksum.');
}

const files = await listFiles(frameworkRoot);
if (!files.some((file) => /^KqlWasmBridge\..+\.wasm$/.test(file))) {
	throw new Error('KQL translator framework is missing the KqlWasmBridge assembly.');
}
if (!files.some((file) => /^dotnet\.native\..+\.wasm$/.test(file))) {
	throw new Error('KQL translator framework is missing the .NET native runtime.');
}

const actualChecksum = await hashDirectory(frameworkRoot);
if (actualChecksum !== manifest.frameworkSha256) {
	throw new Error('KQL translator framework checksum does not match its manifest. Rebuild it.');
}

console.log(`Verified KQL translator WebAssembly from ${manifest.translator.commit}.`);

async function hashDirectory(directory) {
	const files = (await listFiles(directory)).sort((left, right) => left.localeCompare(right));
	const digest = createHash('sha256');

	for (const file of files) {
		const contents = await readFile(resolve(directory, file));
		digest.update(file);
		digest.update('\0');
		digest.update(contents);
		digest.update('\0');
	}

	return digest.digest('hex');
}

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
