import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const executeFile = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultFilePath = resolve(scriptDirectory, '../samples/kite-test-logs.json');
const defaultStream = 'Custom-KiteTestInput';

function usage(message) {
	if (message) {
		console.error(`Error: ${message}`);
	}

	console.error(`Usage: node infra/azure/scripts/post-kite-test-logs.mjs \\
  --endpoint <logs-ingestion-endpoint> \\
  --dcr-immutable-id <dcr-id> \\
  [--stream <stream-name>] \\
  [--file <json-file>]`);
	process.exitCode = 1;
}

function parseArguments(args) {
	const options = {
		endpoint: process.env.KITE_LOGS_INGESTION_ENDPOINT,
		dcrImmutableId: process.env.KITE_LOGS_DCR_IMMUTABLE_ID,
		stream: process.env.KITE_LOGS_INPUT_STREAM ?? defaultStream,
		filePath: process.env.KITE_LOGS_FILE ?? defaultFilePath
	};

	const flags = new Map([
		['--endpoint', 'endpoint'],
		['--dcr-immutable-id', 'dcrImmutableId'],
		['--stream', 'stream'],
		['--file', 'filePath']
	]);

	for (let index = 0; index < args.length; index += 1) {
		const option = flags.get(args[index]);
		const value = args[index + 1];

		if (!option) {
			throw new Error(`Unknown argument: ${args[index]}`);
		}
		if (!value) {
			throw new Error(`${args[index]} requires a value.`);
		}

		options[option] = option === 'filePath' ? resolve(value) : value;
		index += 1;
	}

	if (!options.endpoint) {
		throw new Error('Provide --endpoint or set KITE_LOGS_INGESTION_ENDPOINT.');
	}
	if (!options.dcrImmutableId) {
		throw new Error('Provide --dcr-immutable-id or set KITE_LOGS_DCR_IMMUTABLE_ID.');
	}

	return options;
}

async function getAccessToken() {
	try {
		const { stdout } = await executeFile('az', [
			'account',
			'get-access-token',
			'--resource',
			'https://monitor.azure.com/',
			'--query',
			'accessToken',
			'--output',
			'tsv'
		]);
		return stdout.trim();
	} catch {
		throw new Error(
			'Azure CLI authentication failed. Run `az login` and select the target subscription first.'
		);
	}
}

async function main() {
	const { endpoint, dcrImmutableId, stream, filePath } = parseArguments(process.argv.slice(2));
	const payload = await readFile(filePath, 'utf8');
	const records = JSON.parse(payload);

	if (!Array.isArray(records) || records.length === 0) {
		throw new Error('The input file must contain a non-empty JSON array.');
	}

	const accessToken = await getAccessToken();
	const url = new URL(
		`dataCollectionRules/${encodeURIComponent(dcrImmutableId)}/streams/${encodeURIComponent(stream)}`,
		`${endpoint.replace(/\/$/, '')}/`
	);
	url.searchParams.set('api-version', '2023-01-01');

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: payload
	});

	if (!response.ok) {
		throw new Error(`Logs Ingestion API returned ${response.status}: ${await response.text()}`);
	}

	console.log(`Posted ${records.length} records to ${stream}.`);
}

main().catch((error) => usage(error.message));
