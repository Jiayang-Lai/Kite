import { describe, expect, it } from 'vitest';

import { planReleaseTag } from './release-tag-plan.mjs';

const versions = { main: '0.2.0', rc1: '0.2.0', rc2: '0.2.0', old: '0.1.0' };
const versionAt = (sha) => versions[sha];

describe('planReleaseTag', () => {
	it('creates the first release candidate from package.json', () => {
		expect(
			planReleaseTag({ type: 'release-candidate', candidateSha: 'main', versionAt, tags: [] })
		).toEqual({ tag: 'v0.2.0-rc.1', sha: 'main', version: '0.2.0' });
	});

	it('numbers the next release candidate after the highest existing one', () => {
		const tags = [
			{ name: 'v0.2.0-rc.2', sha: 'rc2' },
			{ name: 'v0.2.0-rc.10', sha: 'rc1' },
			{ name: 'v0.1.0-rc.4', sha: 'old' }
		];
		expect(
			planReleaseTag({ type: 'release-candidate', candidateSha: 'main', versionAt, tags }).tag
		).toBe('v0.2.0-rc.11');
	});

	it('refuses a second release candidate on the same commit', () => {
		expect(() =>
			planReleaseTag({
				type: 'release-candidate',
				candidateSha: 'rc2',
				versionAt,
				tags: [{ name: 'v0.2.0-rc.2', sha: 'rc2' }]
			})
		).toThrow('already points to');
	});

	it('refuses to tag a version that is already released', () => {
		const tags = [{ name: 'v0.2.0', sha: 'rc2' }];
		for (const type of ['release-candidate', 'stable']) {
			expect(() => planReleaseTag({ type, candidateSha: 'main', versionAt, tags })).toThrow(
				'already released'
			);
		}
	});

	it('tags the latest release candidate commit as stable, not the latest main commit', () => {
		const tags = [
			{ name: 'v0.2.0-rc.1', sha: 'rc1' },
			{ name: 'v0.2.0-rc.2', sha: 'rc2' }
		];
		expect(planReleaseTag({ type: 'stable', candidateSha: 'main', versionAt, tags })).toEqual({
			tag: 'v0.2.0',
			sha: 'rc2',
			version: '0.2.0'
		});
	});

	it('requires a release candidate before a stable release', () => {
		expect(() =>
			planReleaseTag({ type: 'stable', candidateSha: 'main', versionAt, tags: [] })
		).toThrow('No release candidate exists for 0.2.0');
	});

	it('rejects a prerelease or malformed package.json version', () => {
		expect(() =>
			planReleaseTag({
				type: 'release-candidate',
				candidateSha: 'main',
				versionAt: () => '0.2.0-beta.1',
				tags: []
			})
		).toThrow('expected MAJOR.MINOR.PATCH');
	});
});
