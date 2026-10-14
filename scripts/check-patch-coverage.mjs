import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
	changedLinesFromDiff,
	coverageFromLcov,
	uncoveredChangedLines
} from './lib/patch-coverage.mjs';

// Lists the changed lines that `npm run test:coverage` left uncovered, so they can be fixed before
// Codecov's patch report flags them. Compares against where this branch left the base branch,
// including uncommitted changes. Usage: npm run coverage:patch [-- <base-branch>]
const base = process.argv[2] ?? 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const root = git('rev-parse', '--show-toplevel').trim();
const mergeBase = git('merge-base', base, 'HEAD').trim();

let lcov;
try {
	lcov = readFileSync(`${root}/coverage/lcov.info`, 'utf8');
} catch {
	console.error('coverage/lcov.info is missing. Run npm run test:coverage first.');
	process.exit(1);
}

const changed = changedLinesFromDiff(git('diff', '--unified=0', mergeBase, '--', 'src'));
const { coverable, findings } = uncoveredChangedLines(changed, coverageFromLcov(lcov, root));

if (!findings.length) {
	console.log(`All ${coverable} changed coverable lines in src are covered.`);
	process.exit(0);
}
for (const { file, line, kind } of findings) {
	console.log(
		`${file}:${line} ${kind === 'partial' ? 'has a branch that never ran' : 'never ran'}`
	);
}
console.log(
	`\n${findings.length} of ${coverable} changed coverable lines are not fully covered. Codecov marks the patch report with ❌ for any of them.`
);
process.exit(1);
