import { cp, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const translatorRoot = resolve(projectRoot, 'vendor/kql-to-sql');
const bridgeProject = resolve(translatorRoot, 'src/KqlWasmBridge/KqlWasmBridge.csproj');
const staticRoot = resolve(projectRoot, 'static');
const artifactRoot = resolve(staticRoot, 'kql-wasm');
const temporaryRoot = resolve(projectRoot, '.svelte-kit/kql-wasm-build');

await rm(temporaryRoot, { recursive: true, force: true });
await mkdir(temporaryRoot, { recursive: true });

try {
	console.log('Publishing the pinned KQL-to-SQL WebAssembly bridge...');
	await execFile(
		'dotnet',
		['publish', bridgeProject, '--configuration', 'Release', '--output', temporaryRoot, '--nologo'],
		{ cwd: translatorRoot }
	);

	const frameworkSource = resolve(temporaryRoot, 'wwwroot/_framework');
	const stagingRoot = resolve(staticRoot, `.kql-wasm-${randomUUID()}`);
	const stagingFramework = resolve(stagingRoot, '_framework');
	await cp(frameworkSource, stagingFramework, { recursive: true, errorOnExist: true });

	await verifyFramework(stagingFramework);
	await replaceDirectory(stagingRoot, artifactRoot);
	console.log(`KQL translator WebAssembly built at ${relative(projectRoot, artifactRoot)}.`);
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}

async function verifyFramework(frameworkDirectory) {
	const files = await listFiles(frameworkDirectory);
	const requiredFiles = ['dotnet.js'];
	for (const file of requiredFiles) {
		if (!files.includes(file)) {
			throw new Error(`Published KQL translator framework is missing ${file}.`);
		}
	}
	if (!files.some((file) => /^KqlWasmBridge\..+\.wasm$/.test(file))) {
		throw new Error('Published KQL translator framework is missing the KqlWasmBridge assembly.');
	}
	if (!files.some((file) => /^dotnet\.native\..+\.wasm$/.test(file))) {
		throw new Error('Published KQL translator framework is missing the .NET native runtime.');
	}
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

async function replaceDirectory(stagingDirectory, destinationDirectory) {
	const backupDirectory = `${destinationDirectory}.previous-${randomUUID()}`;
	let movedExistingDirectory = false;

	try {
		await rename(destinationDirectory, backupDirectory);
		movedExistingDirectory = true;
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}

	try {
		await rename(stagingDirectory, destinationDirectory);
	} catch (error) {
		if (movedExistingDirectory) await rename(backupDirectory, destinationDirectory);
		throw error;
	}

	if (movedExistingDirectory) await rm(backupDirectory, { recursive: true, force: true });
}
