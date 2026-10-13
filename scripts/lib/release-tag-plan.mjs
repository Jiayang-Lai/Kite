const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Decides which release tag to create from the version in package.json, so the version is never
 * typed by hand.
 *
 * - A release candidate tags `candidateSha` (a commit on main) as the next `vX.Y.Z-rc.N`.
 * - A stable release tags the commit of the newest release candidate, because production must deploy exactly what final UAT approved. `candidateSha` is
 *   ignored, so later version bumps on main do not change which candidate is promoted.
 *
 * @param {object} input
 * @param {'release-candidate' | 'stable'} input.type
 * @param {string} [input.candidateSha] Commit proposed for a release candidate.
 * @param {(sha: string) => string} input.versionAt Returns package.json's version at a commit.
 * @param {{ name: string, sha: string }[]} input.tags Existing tags and the commits they resolve to.
 * @returns {{ tag: string, sha: string, version: string }}
 */
export function planReleaseTag({ type, candidateSha, versionAt, tags }) {
	const tagNames = new Set(tags.map((tag) => tag.name));

	if (type === 'release-candidate') {
		const version = requireStableVersion(versionAt(candidateSha), candidateSha);
		requireUnreleased(version, tagNames);
		const candidates = releaseCandidates(version, tags);
		const existing = candidates.find((candidate) => candidate.sha === candidateSha);
		if (existing) {
			throw new Error(
				`${existing.name} already points to ${shortSha(candidateSha)}. Merge a change to main before creating another release candidate.`
			);
		}
		const next = (candidates[0]?.number ?? 0) + 1;
		return { tag: `v${version}-rc.${next}`, sha: candidateSha, version };
	}

	if (type === 'stable') {
		// The candidate decides the version, so a version bump already merged to main cannot block
		// promoting the release candidate that is awaiting approval.
		const latest = releaseCandidates(undefined, tags)[0];
		if (!latest) {
			throw new Error('No release candidate exists. Create and approve a release candidate first.');
		}
		const { version } = latest;
		requireUnreleased(version, tagNames);
		const candidateVersion = versionAt(latest.sha);
		if (candidateVersion !== version) {
			throw new Error(
				`${latest.name} has package.json version ${candidateVersion}, not ${version}.`
			);
		}
		return { tag: `v${version}`, sha: latest.sha, version };
	}

	throw new Error(`Unknown release type ${JSON.stringify(type)}.`);
}

function requireStableVersion(version, sha) {
	if (typeof version !== 'string' || !STABLE_VERSION.test(version)) {
		throw new Error(
			`package.json at ${shortSha(sha)} has version ${JSON.stringify(version)}; expected MAJOR.MINOR.PATCH.`
		);
	}
	return version;
}

function requireUnreleased(version, tagNames) {
	if (tagNames.has(`v${version}`)) {
		throw new Error(
			`v${version} is already released. Bump the version in package.json through a pull request first.`
		);
	}
}

/** Release candidates for `version` (every version when omitted), newest first. */
function releaseCandidates(version, tags) {
	const pattern = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-rc\.([1-9]\d*)$/;
	return tags
		.map((tag) => {
			const match = pattern.exec(tag.name);
			return match && { ...tag, version: match[1], number: Number(match[2]) };
		})
		.filter((tag) => tag && (version === undefined || tag.version === version))
		.sort(
			(left, right) => compareVersions(right.version, left.version) || right.number - left.number
		);
}

function compareVersions(left, right) {
	const leftParts = left.split('.').map(Number);
	const rightParts = right.split('.').map(Number);
	return leftParts.reduce((order, part, index) => order || part - rightParts[index], 0);
}

function shortSha(sha) {
	return sha.slice(0, 12);
}
