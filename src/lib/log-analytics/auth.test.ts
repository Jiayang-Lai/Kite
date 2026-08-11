import { describe, expect, it, vi } from 'vitest';

const msal = vi.hoisted(() => ({
	createStandardPublicClientApplication: vi.fn(),
	InteractionRequiredAuthError: class InteractionRequiredAuthError extends Error {}
}));

vi.mock('@azure/msal-browser', () => msal);

import { acquireLogAnalyticsToken, getLogAnalyticsAccount, logoutLogAnalytics } from './auth';

describe('Log Analytics authentication', () => {
	it('logs out the cached account and requires a new interactive sign-in', async () => {
		vi.stubGlobal('window', { location: { origin: 'https://kite.example.test' } });
		const account = {
			homeAccountId: 'home-account-id',
			localAccountId: 'local-account-id',
			tenantId: 'tenant-id',
			username: 'alex@example.test'
		};
		const config = {
			workspaceId: 'workspace-id',
			tenantId: 'tenant-id',
			clientId: 'client-id',
			account
		};
		const firstClient = {
			getAccount: vi.fn(() => account),
			logoutPopup: vi.fn(async () => undefined)
		};
		const secondClient = {
			getAccount: vi.fn(() => null),
			loginPopup: vi.fn(async () => ({ account, accessToken: 'new-token' })),
			setActiveAccount: vi.fn(),
			acquireTokenSilent: vi.fn(async () => ({ account, accessToken: 'new-token' }))
		};
		msal.createStandardPublicClientApplication
			.mockResolvedValueOnce(firstClient)
			.mockResolvedValueOnce(secondClient);

		try {
			expect(await getLogAnalyticsAccount(config)).toBe(account);
			await logoutLogAnalytics(config);
			expect(firstClient.logoutPopup).toHaveBeenCalledWith({
				account,
				postLogoutRedirectUri: 'https://kite.example.test/auth/callback'
			});

			await expect(acquireLogAnalyticsToken(config)).resolves.toBe('new-token');
			expect(secondClient.loginPopup).toHaveBeenCalledWith(
				expect.objectContaining({ prompt: 'select_account' })
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('cleans up an abandoned sign-in marker before opening a logout popup', async () => {
		vi.stubGlobal('window', {
			location: { origin: 'https://kite.example.test' },
			sessionStorage: {
				getItem: vi.fn(() => JSON.stringify({ clientId: 'another-client-id', type: 'signin' }))
			}
		});
		const account = {
			homeAccountId: 'home-account-id',
			localAccountId: 'local-account-id',
			tenantId: 'tenant-id',
			username: 'alex@example.test'
		};
		const client = {
			getAccount: vi.fn(() => account),
			handleRedirectPromise: vi.fn(async () => null),
			logoutPopup: vi.fn(async () => undefined)
		};
		msal.createStandardPublicClientApplication.mockResolvedValueOnce(client);

		try {
			await logoutLogAnalytics({
				workspaceId: 'workspace-id',
				tenantId: 'tenant-id',
				clientId: 'another-client-id',
				account
			});

			expect(client.handleRedirectPromise).toHaveBeenCalledOnce();
			expect(client.logoutPopup).toHaveBeenCalledOnce();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
