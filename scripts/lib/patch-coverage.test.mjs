import { describe, expect, it } from 'vitest';

import {
	changedLinesFromDiff,
	coverageFromLcov,
	uncoveredChangedLines
} from './patch-coverage.mjs';

// A real `git diff --unified=0` shape: a changed file, a deletion-only hunk, and a removed file.
const DIFF = [
	'diff --git a/src/lib/a.ts b/src/lib/a.ts',
	'--- a/src/lib/a.ts',
	'+++ b/src/lib/a.ts',
	'@@ -3 +3,2 @@ export function a() {',
	'-\told();',
	'+\tnewer();',
	'+\tnewest();',
	'@@ -9,2 +10,0 @@ export function a() {',
	'-\tgone();',
	'-\talsoGone();',
	'@@ -20 +21 @@',
	'+\tsingle();',
	'diff --git a/src/lib/removed.ts b/src/lib/removed.ts',
	'--- a/src/lib/removed.ts',
	'+++ /dev/null',
	'@@ -1 +0,0 @@',
	'-removed();'
].join('\n');

const LCOV = [
	'TN:',
	'SF:/repo/src/lib/a.ts',
	'DA:3,4',
	'DA:4,0',
	'DA:21,2',
	'BRDA:3,0,0,4',
	'BRDA:3,0,1,1',
	'BRDA:21,1,0,2',
	'BRDA:21,1,1,-',
	'end_of_record',
	'SF:/repo/src/lib/b.ts',
	'DA:1,1',
	'end_of_record'
].join('\n');

describe('patch coverage', () => {
	it('collects added and changed lines, skipping deletions and removed files', () => {
		expect(changedLinesFromDiff(DIFF)).toEqual(new Map([['src/lib/a.ts', new Set([3, 4, 21])]]));
	});

	it('reads LCOV paths relative to the repository root', () => {
		const coverage = coverageFromLcov(LCOV, '/repo');

		expect([...coverage.keys()]).toEqual(['src/lib/a.ts', 'src/lib/b.ts']);
		expect(coverage.get('src/lib/a.ts')?.branches.get(21)).toEqual([2, 0]);
	});

	it('reports lines that never ran and lines with a branch that never ran', () => {
		const result = uncoveredChangedLines(
			changedLinesFromDiff(DIFF),
			coverageFromLcov(LCOV, '/repo')
		);

		expect(result).toEqual({
			coverable: 3,
			findings: [
				{ file: 'src/lib/a.ts', line: 4, kind: 'uncovered' },
				{ file: 'src/lib/a.ts', line: 21, kind: 'partial' }
			]
		});
	});

	it('ignores changed files and lines the report does not instrument', () => {
		const changed = new Map([
			['src/lib/a.ts', new Set([5])],
			['src/lib/a.test.ts', new Set([1])]
		]);

		expect(uncoveredChangedLines(changed, coverageFromLcov(LCOV, '/repo'))).toEqual({
			coverable: 0,
			findings: []
		});
	});
});
