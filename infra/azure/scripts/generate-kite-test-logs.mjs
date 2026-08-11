import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_COUNT = 500;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultOutputPath = resolve(scriptDirectory, '../samples/kite-test-logs.json');

function usage(message) {
	if (message) {
		console.error(`Error: ${message}`);
	}

	console.error(
		'Usage: node infra/azure/scripts/generate-kite-test-logs.mjs [--count <positive-integer>] [--output <path>]'
	);
	process.exitCode = 1;
}

function parseArguments(args) {
	let count = DEFAULT_COUNT;
	let outputPath = defaultOutputPath;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		const value = args[index + 1];

		if (argument === '--count') {
			if (!value || !/^\d+$/.test(value)) {
				throw new Error('--count must be a positive integer.');
			}
			count = Number(value);
			index += 1;
			continue;
		}

		if (argument === '--output') {
			if (!value) {
				throw new Error('--output requires a file path.');
			}
			outputPath = resolve(value);
			index += 1;
			continue;
		}

		throw new Error(`Unknown argument: ${argument}`);
	}

	if (!Number.isSafeInteger(count) || count < 1) {
		throw new Error('--count must be a positive integer.');
	}

	return { count, outputPath };
}

async function main() {
	const { count, outputPath } = parseArguments(process.argv.slice(2));
	const generatedAt = Date.now();
	const records = Array.from({ length: count }, (_, index) => {
		const sequence = index + 1;
		return {
			TimeGenerated: new Date(generatedAt - (count - sequence) * 1_000).toISOString(),
			BooleanValue: sequence % 2 === 0,
			DynamicValue: {
				environment: 'test',
				labels: ['kite', 'dcr', 'generated'],
				metadata: { sequence, generatedAt: new Date(generatedAt).toISOString() }
			},
			GuidValue: `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`,
			IntValue: sequence,
			LongValue: 9_007_199_250_000_000 + sequence,
			RealValue: sequence + 0.125,
			StringValue: `Kite generated test record ${sequence}`
		};
	});

	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(records, null, 2)}\n`);
	console.log(`Wrote ${count} records to ${outputPath}`);
}

main().catch((error) => usage(error.message));
