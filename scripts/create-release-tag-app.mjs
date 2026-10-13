import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

import {
	appSlug,
	buildManifest,
	createAppJwt,
	manifestFormHtml,
	setTfvarsValue
} from './lib/release-tag-app.mjs';

// Registers the GitHub App defined in infra/github/release-tag-app.json through GitHub's manifest
// flow, stores its private key as an environment secret without writing it to disk, waits for the
// App to be installed on the repository, and records its slug for Terraform.
// See infra/github/README.md#release-tag-github-app.

const MANIFEST_FLOW_LIMIT_MS = 60 * 60 * 1000;
const INSTALLATION_POLL_MS = 5_000;
const API = 'https://api.github.com';
const options = parseOptions(process.argv.slice(2));
const [owner, repositoryName] = options.repo.split('/');
const template = JSON.parse(readFileSync(options.manifest, 'utf8'));
if (options.name) template.name = options.name;

preflight();

const state = randomBytes(16).toString('hex');
const baseUrl = `http://localhost:${options.port}`;
const manifest = buildManifest(template, { redirectUrl: `${baseUrl}/callback` });
const ownerType = gh(['api', `users/${owner}`, '--jq', '.type']);
const registrationUrl =
	ownerType === 'Organization'
		? `https://github.com/organizations/${owner}/settings/apps/new?state=${state}`
		: `https://github.com/settings/apps/new?state=${state}`;

const deadline = setTimeout(
	() => fail('The one-hour manifest flow limit expired.'),
	MANIFEST_FLOW_LIMIT_MS
);
let handled = false;

const server = createServer(async (request, response) => {
	const url = new URL(request.url ?? '/', baseUrl);
	if (url.pathname === '/') {
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		response.end(manifestFormHtml({ action: registrationUrl, manifest }));
		return;
	}
	if (url.pathname !== '/callback') {
		response.writeHead(404).end();
		return;
	}
	if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
		response.writeHead(400).end('This registration link does not belong to the running script.');
		return;
	}
	if (handled) {
		response.writeHead(409).end('This registration was already completed.');
		return;
	}
	handled = true;

	try {
		const app = await convertManifest(url.searchParams.get('code'));
		console.log(`Registered ${app.name} (App ID ${app.id}): ${app.html_url}`);
		storePrivateKey(app);
		recordAppId(app.id);
		const installUrl = `https://github.com/apps/${app.slug}/installations/new`;
		response.writeHead(302, { location: installUrl }).end();
		console.log(
			`\nInstall the App on ${options.repo} only (Only select repositories → ${repositoryName}).\nYour browser was redirected to ${installUrl}`
		);
		await waitForInstallation(app);
		finish(app);
	} catch (error) {
		if (!response.headersSent) response.writeHead(500).end(String(error.message ?? error));
		fail(error.message ?? String(error));
	}
});

// IPv4 loopback: Node resolves `localhost` to ::1 first in the dev container, which VS Code's
// port forwarder cannot reach. Browsers still reach it through the forwarded localhost port.
server.listen(options.port, '127.0.0.1', () => {
	console.log(`Open ${baseUrl}/ in your browser to register "${template.name}" on GitHub.`);
	console.log('Waiting for registration…');
});

async function convertManifest(code) {
	const response = await fetch(`${API}/app-manifests/${encodeURIComponent(code)}/conversions`, {
		method: 'POST',
		headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
	});
	if (!response.ok) {
		throw new Error(`GitHub could not complete the registration (HTTP ${response.status}).`);
	}
	return response.json();
}

function storePrivateKey(app) {
	// The key goes straight from GitHub's response to the secret over stdin; it is never printed
	// or written to disk.
	const result = spawnSync(
		'gh',
		[
			'secret',
			'set',
			'RELEASE_TAG_APP_PRIVATE_KEY',
			'--env',
			options.environment,
			'--repo',
			options.repo
		],
		{ input: app.pem, encoding: 'utf8' }
	);
	if (result.status !== 0) {
		throw new Error(
			`The App was registered, but storing its private key failed: ${result.stderr.trim()}\n` +
				`Generate a new private key at ${app.html_url} and run:\n` +
				`  gh secret set RELEASE_TAG_APP_PRIVATE_KEY --env ${options.environment} --repo ${options.repo} < key.pem`
		);
	}
	console.log(`Stored the private key as RELEASE_TAG_APP_PRIVATE_KEY on ${options.environment}.`);
}

function recordAppId(appId) {
	// The App is private, so Terraform records its numeric ID rather than looking up the slug,
	// which GitHub hides from fine-grained tokens.
	if (!existsSync(options.tfvars)) {
		console.log(`Add this line to ${options.tfvars}:\n  release_tag_app_id = ${appId}`);
		return;
	}
	const text = readFileSync(options.tfvars, 'utf8');
	writeFileSync(options.tfvars, setTfvarsValue(text, 'release_tag_app_id', appId));
	console.log(`Set release_tag_app_id = ${appId} in ${options.tfvars}.`);
}

async function waitForInstallation(app) {
	for (;;) {
		const jwt = createAppJwt({ appId: app.id, privateKey: app.pem });
		const installations = await appRequest(jwt, '/app/installations');
		const installation = installations.find(
			(item) => item.account?.login?.toLowerCase() === owner.toLowerCase()
		);
		if (installation) {
			await verifyRepositoryAccess(jwt, installation);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, INSTALLATION_POLL_MS));
	}
}

/** Confirms the installation can reach the repository by requesting a read-only token for it. */
async function verifyRepositoryAccess(jwt, installation) {
	const response = await fetch(`${API}/app/installations/${installation.id}/access_tokens`, {
		method: 'POST',
		headers: apiHeaders(jwt),
		body: JSON.stringify({ repositories: [repositoryName], permissions: { contents: 'read' } })
	});
	if (!response.ok) {
		throw new Error(
			`The App is installed on ${owner} but cannot access ${options.repo}. Add the repository at https://github.com/settings/installations/${installation.id}.`
		);
	}
	const { token } = await response.json();
	await fetch(`${API}/installation/token`, { method: 'DELETE', headers: apiHeaders(token) });
	if (installation.repository_selection === 'all') {
		console.warn(
			`Warning: the App is installed on all of ${owner}'s repositories. Restrict it to ${repositoryName} at https://github.com/settings/installations/${installation.id}.`
		);
	}
	console.log(`Verified the App's installation on ${options.repo}.`);
}

async function appRequest(jwt, path) {
	const response = await fetch(`${API}${path}`, { headers: apiHeaders(jwt) });
	if (!response.ok) throw new Error(`GitHub API ${path} returned HTTP ${response.status}.`);
	return response.json();
}

function apiHeaders(token) {
	return {
		accept: 'application/vnd.github+json',
		authorization: `Bearer ${token}`,
		'x-github-api-version': '2022-11-28'
	};
}

function preflight() {
	const ghVersion = spawnSync('gh', ['--version'], { encoding: 'utf8' });
	if (ghVersion.error || ghVersion.status !== 0) {
		fail('The GitHub CLI (gh) is required: https://cli.github.com/');
	}
	if (spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status !== 0) {
		fail('Sign in to the GitHub CLI first: gh auth login');
	}
	const environment = spawnSync(
		'gh',
		['api', `repos/${options.repo}/environments/${options.environment}`, '--silent'],
		{ encoding: 'utf8' }
	);
	if (environment.status !== 0) {
		fail(
			`The ${options.environment} environment does not exist on ${options.repo}. Apply infra/github with Terraform first.`
		);
	}
	const existing = spawnSync('gh', ['api', `apps/${appSlug(template.name)}`, '--silent'], {
		encoding: 'utf8'
	});
	if (existing.status === 0) {
		fail(
			`A GitHub App named "${template.name}" already exists. If it is yours, set release_tag_app_id to its App ID instead of registering again; otherwise choose another name with --name.`
		);
	}
}

function finish(app) {
	clearTimeout(deadline);
	server.close();
	console.log(
		`\nDone. Apply infra/github with Terraform to make "${app.name}" the only way to create release tags:\n  make tf ROOT=github CMD="plan -out=tfplan"\n  make tf ROOT=github CMD="apply tfplan"`
	);
}

function fail(message) {
	console.error(`Error: ${message}`);
	process.exit(1);
}

function gh(arguments_) {
	return execFileSync('gh', arguments_, { encoding: 'utf8' }).trim();
}

function parseOptions(arguments_) {
	const values = {
		repo: 'Jiayang-Lai/Kite',
		environment: 'release-tagging',
		manifest: 'infra/github/release-tag-app.json',
		tfvars: 'infra/github/terraform.tfvars',
		port: '47819',
		name: ''
	};
	for (let index = 0; index < arguments_.length; index += 2) {
		const key = arguments_[index]?.replace(/^--/, '');
		const value = arguments_[index + 1];
		if (
			!arguments_[index]?.startsWith('--') ||
			!Object.hasOwn(values, key) ||
			value === undefined
		) {
			fail(
				'Usage: create-release-tag-app.mjs [--repo owner/name] [--name "App name"] [--port 47819] [--environment release-tagging] [--manifest path] [--tfvars path]'
			);
		}
		values[key] = value;
	}
	if (!/^[^/]+\/[^/]+$/.test(values.repo)) fail('--repo must look like owner/name.');
	return values;
}
