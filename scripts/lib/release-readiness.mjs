/**
 * Checks that a commit can be released. The Create release tag workflow runs these checks before
 * it creates a tag, and the Release workflow repeats them afterwards. Release tags cannot be
 * deleted, so a tag created for a commit that cannot ship would use up its version.
 *
 * - A release candidate needs the artifact from a successful Main UAT push run for its commit.
 * - A stable release needs the artifact retained by its release candidate's successful Release
 *   run, and a successful deployment of that candidate to the release-candidate environment.
 *
 * `github` is the Octokit client that actions/github-script provides.
 *
 * @param {object} input
 * @param {any} input.github
 * @param {string} input.owner
 * @param {string} input.repo
 * @param {'rc' | 'stable'} input.type
 * @param {string} input.commitSha Commit the release tag points to.
 * @param {string} [input.rcTag] Release candidate being promoted; required for a stable release.
 * @returns {Promise<{ artifactId: number, runId: number }>} The artifact to deploy.
 */
export async function checkReleaseReadiness({ github, owner, repo, type, commitSha, rcTag }) {
	if (type !== 'rc' && type !== 'stable') {
		throw new Error(`Unknown release type ${JSON.stringify(type)}.`);
	}
	if (type === 'stable' && !rcTag) {
		throw new Error('A stable release needs the release candidate it promotes.');
	}

	const artifact = await findReleaseArtifact({ github, owner, repo, type, commitSha, rcTag });
	if (type === 'stable') {
		await requireCandidateDeployment({ github, owner, repo, rcTag });
	}
	return artifact;
}

async function findReleaseArtifact({ github, owner, repo, type, commitSha, rcTag }) {
	const isCandidate = type === 'rc';
	const artifactName = isCandidate ? `kite-pages-${commitSha}` : `kite-rc-${rcTag}`;
	const artifacts = await github.paginate(github.rest.actions.listArtifactsForRepo, {
		owner,
		repo,
		name: artifactName,
		per_page: 100
	});

	const candidates = artifacts
		.filter((artifact) => !artifact.expired && artifact.workflow_run)
		.sort((left, right) => new Date(right.created_at) - new Date(left.created_at));

	for (const artifact of candidates) {
		const { data: run } = await github.rest.actions.getWorkflowRun({
			owner,
			repo,
			run_id: artifact.workflow_run.id
		});

		const expectedSource = isCandidate
			? run.path === '.github/workflows/main-uat.yml' && run.head_branch === 'main'
			: run.path === '.github/workflows/release.yml' && run.head_branch === rcTag;

		if (
			expectedSource &&
			run.event === 'push' &&
			run.head_sha === commitSha &&
			run.conclusion === 'success'
		) {
			return { artifactId: artifact.id, runId: run.id };
		}
	}

	throw new Error(
		isCandidate
			? `No successful Main UAT artifact named ${artifactName} exists for ${commitSha}. Wait for Main UAT to pass on this commit, or choose a newer commit.`
			: `No successful release-candidate artifact named ${artifactName} exists for ${commitSha}. Artifacts expire after 90 days; create a new release candidate if this one has expired.`
	);
}

async function requireCandidateDeployment({ github, owner, repo, rcTag }) {
	const deployments = await github.paginate(github.rest.repos.listDeployments, {
		owner,
		repo,
		environment: 'release-candidate',
		ref: rcTag,
		per_page: 100
	});

	for (const deployment of deployments) {
		const statuses = await github.paginate(github.rest.repos.listDeploymentStatuses, {
			owner,
			repo,
			deployment_id: deployment.id,
			per_page: 100
		});
		if (statuses.some((status) => status.state === 'success')) return;
	}

	throw new Error(
		`No successful release-candidate deployment exists for ${rcTag}. Wait for its Release run to finish deploying before promoting it.`
	);
}
