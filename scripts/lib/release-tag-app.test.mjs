import { createVerify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
	appSlug,
	buildManifest,
	createAppJwt,
	manifestFormHtml,
	setTfvarsValue
} from './release-tag-app.mjs';

const manifest = JSON.parse(
	readFileSync(new URL('../../infra/github/release-tag-app.json', import.meta.url), 'utf8')
);

describe('release-tag GitHub App manifest', () => {
	it('grants only contents write and subscribes to no webhooks', () => {
		expect(manifest.default_permissions).toEqual({ contents: 'write' });
		expect(manifest.default_events).toEqual([]);
		expect(manifest.hook_attributes.active).toBe(false);
		expect(manifest.public).toBe(false);
		expect(manifest.name.length).toBeLessThanOrEqual(34);
	});

	it('adds the per-run redirect URL without changing the committed definition', () => {
		const built = buildManifest(manifest, { redirectUrl: 'http://localhost:1/callback' });
		expect(built.redirect_url).toBe('http://localhost:1/callback');
		expect(manifest.redirect_url).toBeUndefined();
	});
});

describe('release-tag App helpers', () => {
	it('derives the slug GitHub assigns to the App name', () => {
		expect(appSlug('Kite release tags')).toBe('kite-release-tags');
		expect(appSlug('  Kite: Release/Tags! ')).toBe('kite-release-tags');
	});

	it('escapes the manifest into the auto-submitting registration form', () => {
		const html = manifestFormHtml({
			action: 'https://github.com/settings/apps/new?state=a&b',
			manifest: { name: `"><script>alert(1)</script>` }
		});
		expect(html).toContain('action="https://github.com/settings/apps/new?state=a&amp;b"');
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&quot;&gt;&lt;script&gt;');
	});

	it('signs an RS256 App JWT that GitHub can verify with the public key', () => {
		const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
		const now = Date.UTC(2026, 9, 13, 12);
		const jwt = createAppJwt({
			appId: 123,
			privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }),
			now
		});
		const [header, payload, signature] = jwt.split('.');

		expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
			alg: 'RS256',
			typ: 'JWT'
		});
		expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
			iat: now / 1000 - 60,
			exp: now / 1000 - 60 + 540,
			iss: '123'
		});
		const verified = createVerify('RSA-SHA256')
			.update(`${header}.${payload}`)
			.verify(publicKey, signature, 'base64url');
		expect(verified).toBe(true);
	});

	it('replaces or appends the App slug in terraform.tfvars', () => {
		const existing = 'cloudflare_account_id = "a"\n# release_tag_app_id = 1234567\n';
		expect(setTfvarsValue(existing, 'release_tag_app_id', 2468)).toBe(
			'cloudflare_account_id = "a"\n# release_tag_app_id = 1234567\n\nrelease_tag_app_id = 2468\n'
		);
		expect(setTfvarsValue('release_tag_slug = "old"\nx = 1\n', 'release_tag_slug', 'new')).toBe(
			'release_tag_slug = "new"\nx = 1\n'
		);
	});
});
