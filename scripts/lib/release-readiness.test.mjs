import { describe, expect, it } from 'vitest';

import { checkReleaseReadiness } from './release-readiness.mjs';

const owner = 'owner';
const repo = 'kite';
const sha = 'abc123';

const mainUatRun = {
	id: 10,
	path: '.github/workflows/main-uat.yml',
	head_branch: 'main',
	event: 'push',
	head_sha: sha,
	conclusion: 'success'
};
const rcReleaseRun = {
	id: 20,
	path: '.github/workflows/release.yml',
	head_branch: 'v1.2.0-rc.1',
	event: 'push',
	head_sha: sha,
	conclusion: 'success'
};

/** A fake of the github-script Octokit client backed by fixed API responses. */
function fakeGithub({ artifacts = [], runs = [], deployments = [], statuses = {} }) {
	const rest = {
		actions: {
			listArtifactsForRepo: ({ name }) => artifacts.filter((artifact) => artifact.name === name),
			getWorkflowRun: async ({ run_id }) => ({ data: runs.find((run) => run.id === run_id) })
		},
		repos: {
			listDeployments: ({ environment, ref }) =>
				deployments.filter(
					(deployment) => deployment.environment === environment && deployment.ref === ref
				),
			listDeploymentStatuses: ({ deployment_id }) => statuses[deployment_id] ?? []
		}
	};
	return { rest, paginate: async (method, parameters) => method(parameters) };
}

const artifact = (id, name, runId, extra = {}) => ({
	id,
	name,
	expired: false,
	created_at: `2026-10-0${id}T00:00:00Z`,
	workflow_run: { id: runId },
	...extra
});

describe('checkReleaseReadiness for a release candidate', () => {
	const check = (github) =>
		checkReleaseReadiness({ github, owner, repo, type: 'rc', commitSha: sha });

	it('returns the Main UAT artifact for the commit', async () => {
		const github = fakeGithub({
			artifacts: [artifact(1, `kite-pages-${sha}`, 10)],
			runs: [mainUatRun]
		});
		await expect(check(github)).resolves.toEqual({ artifactId: 1, runId: 10 });
	});

	it('refuses a commit whose Main UAT run failed', async () => {
		const github = fakeGithub({
			artifacts: [artifact(1, `kite-pages-${sha}`, 10)],
			runs: [{ ...mainUatRun, conclusion: 'failure' }]
		});
		await expect(check(github)).rejects.toThrow('No successful Main UAT artifact');
	});

	it('refuses an expired artifact', async () => {
		const github = fakeGithub({
			artifacts: [artifact(1, `kite-pages-${sha}`, 10, { expired: true })],
			runs: [mainUatRun]
		});
		await expect(check(github)).rejects.toThrow('No successful Main UAT artifact');
	});

	it('refuses an artifact from another workflow or branch', async () => {
		const github = fakeGithub({
			artifacts: [artifact(1, `kite-pages-${sha}`, 10), artifact(2, `kite-pages-${sha}`, 11)],
			runs: [
				{ ...mainUatRun, path: '.github/workflows/preview.yml' },
				{ ...mainUatRun, id: 11, head_branch: 'feature' }
			]
		});
		await expect(check(github)).rejects.toThrow('No successful Main UAT artifact');
	});

	it('uses the newest successful artifact', async () => {
		const github = fakeGithub({
			artifacts: [artifact(1, `kite-pages-${sha}`, 10), artifact(2, `kite-pages-${sha}`, 11)],
			runs: [mainUatRun, { ...mainUatRun, id: 11 }]
		});
		await expect(check(github)).resolves.toEqual({ artifactId: 2, runId: 11 });
	});
});

describe('checkReleaseReadiness for a stable release', () => {
	const rcTag = 'v1.2.0-rc.1';
	const check = (github) =>
		checkReleaseReadiness({ github, owner, repo, type: 'stable', commitSha: sha, rcTag });
	const rcArtifact = artifact(3, `kite-rc-${rcTag}`, 20);
	const rcDeployment = { id: 7, environment: 'release-candidate', ref: rcTag };

	it('returns the retained artifact once the candidate deployed successfully', async () => {
		const github = fakeGithub({
			artifacts: [rcArtifact],
			runs: [rcReleaseRun],
			deployments: [rcDeployment],
			statuses: { 7: [{ state: 'in_progress' }, { state: 'success' }] }
		});
		await expect(check(github)).resolves.toEqual({ artifactId: 3, runId: 20 });
	});

	it('refuses a candidate whose deployment has not succeeded', async () => {
		const github = fakeGithub({
			artifacts: [rcArtifact],
			runs: [rcReleaseRun],
			deployments: [rcDeployment],
			statuses: { 7: [{ state: 'in_progress' }] }
		});
		await expect(check(github)).rejects.toThrow(
			`No successful release-candidate deployment exists for ${rcTag}`
		);
	});

	it('refuses a candidate whose retained artifact expired', async () => {
		const github = fakeGithub({
			artifacts: [{ ...rcArtifact, expired: true }],
			runs: [rcReleaseRun],
			deployments: [rcDeployment],
			statuses: { 7: [{ state: 'success' }] }
		});
		await expect(check(github)).rejects.toThrow('Artifacts expire after 90 days');
	});

	it("refuses an artifact retained by another candidate's run", async () => {
		const github = fakeGithub({
			artifacts: [rcArtifact],
			runs: [{ ...rcReleaseRun, head_branch: 'v1.2.0-rc.2' }],
			deployments: [rcDeployment],
			statuses: { 7: [{ state: 'success' }] }
		});
		await expect(check(github)).rejects.toThrow('No successful release-candidate artifact');
	});

	it('requires the release candidate tag', async () => {
		await expect(
			checkReleaseReadiness({ github: fakeGithub({}), owner, repo, type: 'stable', commitSha: sha })
		).rejects.toThrow('needs the release candidate');
	});
});
