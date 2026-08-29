import { beforeEach, describe, expect, it, vi } from 'vitest';

const msal = vi.hoisted(() => ({
	createStandardPublicClientApplication: vi.fn(),
	InteractionRequiredAuthError: class InteractionRequiredAuthError extends Error {}
}));

vi.mock('@azure/msal-browser', () => msal);

import type { LogAnalyticsConnectionConfiguration } from '$lib/kusto/query-client';
import { LOG_ANALYTICS_SCOPE, LogAnalyticsSessionManager } from './session-manager';

const account = {
	homeAccountId: 'home-account',
	localAccountId: 'local-account',
	tenantId: 'tenant',
	username: 'user@example.test'
};

function configuration(): LogAnalyticsConnectionConfiguration {
	return {
		workspaceId: 'workspace',
		tenantId: 'tenant',
		clientId: 'client',
		account: { ...account }
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('window', {
		location: { origin: 'https://kite.example.test' },
		sessionStorage: { getItem: vi.fn(() => null) }
	});
});

describe('Log Analytics session manager', () => {
	it('deduplicates concurrent silent token requests for one account', async () => {
		let resolveToken!: (value: { account: typeof account; accessToken: string }) => void;
		const token = new Promise<{ account: typeof account; accessToken: string }>(
			(resolve) => (resolveToken = resolve)
		);
		const client = {
			getAccount: vi.fn(() => account),
			acquireTokenSilent: vi.fn(() => token),
			setActiveAccount: vi.fn()
		};
		msal.createStandardPublicClientApplication.mockResolvedValue(client);
		const manager = new LogAnalyticsSessionManager();
		const config = configuration();

		const first = manager.acquireToken(config);
		const second = manager.acquireToken(config);
		await vi.waitFor(() => expect(client.acquireTokenSilent).toHaveBeenCalledOnce());
		resolveToken({ account, accessToken: 'shared-token' });

		await expect(Promise.all([first, second])).resolves.toEqual(['shared-token', 'shared-token']);
		expect(client.acquireTokenSilent).toHaveBeenCalledWith({
			scopes: [LOG_ANALYTICS_SCOPE],
			account
		});
	});

	it('falls back to one interactive token request when silent acquisition requires interaction', async () => {
		const client = {
			getAccount: vi.fn(() => account),
			acquireTokenSilent: vi
				.fn()
				.mockRejectedValue(new msal.InteractionRequiredAuthError('Interaction required')),
			acquireTokenPopup: vi.fn().mockResolvedValue({ account, accessToken: 'popup-token' }),
			setActiveAccount: vi.fn()
		};
		msal.createStandardPublicClientApplication.mockResolvedValue(client);
		const manager = new LogAnalyticsSessionManager();

		await expect(manager.acquireToken(configuration())).resolves.toBe('popup-token');
		expect(client.acquireTokenPopup).toHaveBeenCalledWith({
			scopes: [LOG_ANALYTICS_SCOPE],
			account
		});
		expect(client.setActiveAccount).toHaveBeenCalledWith(account);
	});

	it('deduplicates concurrent sign-in popups for one tenant and client', async () => {
		let resolveLogin!: (value: { account: typeof account; accessToken: string }) => void;
		const login = new Promise<{ account: typeof account; accessToken: string }>(
			(resolve) => (resolveLogin = resolve)
		);
		const client = {
			loginPopup: vi.fn(() => login),
			setActiveAccount: vi.fn()
		};
		msal.createStandardPublicClientApplication.mockResolvedValue(client);
		const manager = new LogAnalyticsSessionManager();
		const config = { ...configuration(), account: undefined };

		const first = manager.signIn(config);
		const second = manager.signIn(config);
		await vi.waitFor(() => expect(client.loginPopup).toHaveBeenCalledOnce());
		resolveLogin({ account, accessToken: 'interactive-token' });

		await expect(Promise.all([first, second])).resolves.toEqual([
			{ account, accessToken: 'interactive-token' },
			{ account, accessToken: 'interactive-token' }
		]);
	});
});
