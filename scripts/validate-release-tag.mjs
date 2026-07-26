import { appendFile } from 'node:fs/promises';

const options = parseOptions(process.argv.slice(2));
const stablePattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const candidatePattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.([1-9]\d*)$/;
const stableMatch = options.tag.match(stablePattern);
const candidateMatch = options.tag.match(candidatePattern);

if (!stableMatch && !candidateMatch) {
	throw new Error(
		`"${options.tag}" is not a supported release tag. Use vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-rc.NUMBER.`
	);
}

const match = candidateMatch ?? stableMatch;
const type = candidateMatch ? 'rc' : 'stable';
const baseTag = `v${match[1]}.${match[2]}.${match[3]}`;
const metadata = {
	tag: options.tag,
	type,
	baseTag,
	version: baseTag.slice(1),
	rcNumber: candidateMatch?.[4] ?? ''
};

if (options.githubOutput) {
	const output = Object.entries(metadata)
		.map(([key, value]) => `${key}=${value}`)
		.join('\n');
	await appendFile(options.githubOutput, `${output}\n`);
}

console.log(JSON.stringify(metadata));

function parseOptions(arguments_) {
	const values = { tag: '', githubOutput: '' };

	for (let index = 0; index < arguments_.length; index += 2) {
		const option = arguments_[index];
		const value = arguments_[index + 1];
		if (!option?.startsWith('--') || value === undefined) {
			throw new Error(`Invalid option: ${option ?? ''}`);
		}
		const key = option === '--github-output' ? 'githubOutput' : option.slice(2);
		if (!Object.hasOwn(values, key)) {
			throw new Error(`Unknown option: ${option}`);
		}
		values[key] = value;
	}

	if (!values.tag) {
		throw new Error('Usage: validate-release-tag.mjs --tag <tag>');
	}

	return values;
}
