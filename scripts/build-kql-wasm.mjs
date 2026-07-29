import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
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

	const manifest = {
		schemaVersion: 1,
		translator: {
			repository: 'https://github.com/Jiayang-Lai/kql-to-sql.git',
			commit: await getGitRevision(translatorRoot)
		},
		frameworkSha256: await hashDirectory(stagingFramework)
	};
	await writeFile(
		resolve(stagingRoot, 'manifest.json'),
		`${JSON.stringify(manifest, null, '\t')}\n`
	);

	await verifyFramework(stagingFramework, manifest);
	await replaceDirectory(stagingRoot, artifactRoot);
	console.log(`KQL translator WebAssembly built at ${relative(projectRoot, artifactRoot)}.`);
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}

async function getGitRevision(repositoryRoot) {
	const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot });
	return stdout.trim();
}

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

async function verifyFramework(frameworkDirectory, manifest) {
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
	if (!/^[0-9a-f]{40}$/i.test(manifest.translator.commit)) {
		throw new Error('KQL translator manifest contains an invalid source commit.');
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
