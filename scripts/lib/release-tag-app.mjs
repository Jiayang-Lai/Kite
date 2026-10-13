import { createSign } from 'node:crypto';

/** Approximates GitHub's slug for an app name, for the pre-registration availability check. */
export function appSlug(name) {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Adds the per-run redirect URL to the committed manifest. */
export function buildManifest(template, { redirectUrl }) {
	return { ...template, redirect_url: redirectUrl };
}

function escapeHtml(value) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** A page that immediately POSTs the manifest to GitHub's registration form. */
export function manifestFormHtml({ action, manifest }) {
	return `<!doctype html>
<meta charset="utf-8">
<title>Register the Kite release-tag GitHub App</title>
<form id="register" action="${escapeHtml(action)}" method="post">
	<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
	<p>Opening GitHub to register the app. If nothing happens, <button type="submit">continue</button>.</p>
</form>
<script>document.getElementById('register').submit();</script>
`;
}

/** Signs a short-lived JWT that authenticates as the GitHub App itself. */
export function createAppJwt({ appId, privateKey, now = Date.now() }) {
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const issuedAt = Math.floor(now / 1000) - 60; // GitHub tolerates limited clock drift.
	const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
		iat: issuedAt,
		exp: issuedAt + 9 * 60,
		iss: String(appId)
	})}`;
	const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
	return `${unsigned}.${signature}`;
}

/** Sets an uncommented `key = "value"` line in a tfvars file, appending it when absent. */
export function setTfvarsValue(text, key, value) {
	const line = `${key} = ${JSON.stringify(value)}`;
	const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'm');
	if (pattern.test(text)) return text.replace(pattern, line);
	return `${text.replace(/\n*$/, '')}${text.trim() ? '\n\n' : ''}${line}\n`;
}
