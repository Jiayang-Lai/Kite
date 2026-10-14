/**
 * Finds changed lines that tests don't fully cover, the way Codecov's patch report counts them: a
 * line is uncovered when it never ran, and partial when one of its branches never ran.
 */

/** Returns the lines each file adds or changes in a zero-context (`-U0`) unified diff. */
export function changedLinesFromDiff(diff) {
	const changed = new Map();
	let file;
	for (const line of diff.split('\n')) {
		if (line.startsWith('+++ ')) {
			file = line.startsWith('+++ b/') ? line.slice(6) : undefined;
			if (file && !changed.has(file)) changed.set(file, new Set());
			continue;
		}
		const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (hunk && file) {
			const start = Number(hunk[1]);
			const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
			for (let lineNumber = start; lineNumber < start + count; lineNumber += 1) {
				changed.get(file).add(lineNumber);
			}
		}
	}
	return changed;
}

/** Reads line hit counts and branch hit counts per file from an LCOV report. */
export function coverageFromLcov(lcov, root) {
	const coverage = new Map();
	let file;
	for (const raw of lcov.split('\n')) {
		const line = raw.trim();
		if (line.startsWith('SF:')) {
			const path = line.slice(3);
			const relative = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
			file = { lines: new Map(), branches: new Map() };
			coverage.set(relative, file);
		} else if (line.startsWith('DA:') && file) {
			const [lineNumber, hits] = line.slice(3).split(',');
			file.lines.set(Number(lineNumber), Number(hits));
		} else if (line.startsWith('BRDA:') && file) {
			const [lineNumber, , , taken] = line.slice(5).split(',');
			const branches = file.branches.get(Number(lineNumber)) ?? [];
			branches.push(taken === '-' ? 0 : Number(taken));
			file.branches.set(Number(lineNumber), branches);
		}
	}
	return coverage;
}

/**
 * Lists changed lines that are instrumented but not fully covered. Files absent from the report,
 * such as tests and configuration, and lines with no code are ignored.
 */
export function uncoveredChangedLines(changed, coverage) {
	const findings = [];
	let coverable = 0;
	for (const [file, lines] of [...changed].sort(([left], [right]) => left.localeCompare(right))) {
		const fileCoverage = coverage.get(file);
		if (!fileCoverage) continue;
		for (const lineNumber of [...lines].sort((left, right) => left - right)) {
			const hits = fileCoverage.lines.get(lineNumber);
			if (hits === undefined) continue;
			coverable += 1;
			if (hits === 0) {
				findings.push({ file, line: lineNumber, kind: 'uncovered' });
			} else if (fileCoverage.branches.get(lineNumber)?.some((taken) => taken === 0)) {
				findings.push({ file, line: lineNumber, kind: 'partial' });
			}
		}
	}
	return { coverable, findings };
}
