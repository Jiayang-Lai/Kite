import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';

import { planReleaseTag } from './lib/release-tag-plan.mjs';

// Used by .github/workflows/create-release-tag.yml. Requires a full clone with tags and
// origin/main fetched. Prints the planned tag and writes it to GITHUB_OUTPUT when requested.
const options = parseOptions(process.argv.slice(2));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const mainSha = git('rev-parse', 'origin/main^{commit}');
const candidateSha = git('rev-parse', `${options.commit || mainSha}^{commit}`);
const isOnMain = (sha) => {
	try {
		git('merge-base', '--is-ancestor', sha, mainSha);
		return true;
	} catch {
		return false;
	}
};
if (!isOnMain(candidateSha)) {
	throw new Error(`${candidateSha} is not a commit on main.`);
}

const tags = git(
	'for-each-ref',
	'--format=%(refname:short) %(objectname) %(*objectname)',
	'refs/tags/v*'
)
	.split('\n')
	.filter(Boolean)
	.map((line) => {
		// Annotated tags report the tagged commit as the dereferenced object.
		const [name, objectSha, peeledSha] = line.split(' ');
		return { name, sha: peeledSha || objectSha };
	});

const plan = planReleaseTag({
	type: options.type,
	candidateSha,
	tags,
	versionAt: (sha) => JSON.parse(git('show', `${sha}:package.json`)).version
});
if (!isOnMain(plan.sha)) throw new Error(`${plan.sha} is not a commit on main.`);

if (options.githubOutput) {
	await appendFile(
		options.githubOutput,
		`tag=${plan.tag}\nsha=${plan.sha}\nversion=${plan.version}\n`
	);
}
console.log(JSON.stringify(plan));

function parseOptions(arguments_) {
	const values = { type: '', commit: '', githubOutput: '' };
	for (let index = 0; index < arguments_.length; index += 2) {
		const option = arguments_[index];
		const value = arguments_[index + 1];
		const key = { '--type': 'type', '--commit': 'commit', '--github-output': 'githubOutput' }[
			option
		];
		if (!key || value === undefined) throw new Error(`Invalid option: ${option ?? ''}`);
		values[key] = value;
	}
	if (!values.type) {
		throw new Error(
			'Usage: plan-release-tag.mjs --type <release-candidate|stable> [--commit <sha>] [--github-output <file>]'
		);
	}
	return values;
}
