import {
	createStandardPublicClientApplication,
	InteractionRequiredAuthError,
	type AccountInfo,
	type IPublicClientApplication
} from '@azure/msal-browser';

import type {
	LogAnalyticsAccountBinding,
	LogAnalyticsConnectionConfiguration
} from '$lib/kusto/query-client';

export const LOG_ANALYTICS_SCOPE = 'https://api.loganalytics.io/.default';

/** Owns browser-local MSAL sessions shared by Log Analytics connections. */
export class LogAnalyticsSessionManager {
	private clients = new Map<string, Promise<IPublicClientApplication>>();
	private tokenRequests = new Map<string, Promise<string>>();
	private signInRequests = new Map<string, ReturnType<IPublicClientApplication['loginPopup']>>();
	private interactiveRequests = new Map<string, Promise<unknown>>();

	private clientKey(config: LogAnalyticsConnectionConfiguration) {
		return `${config.tenantId}\0${config.clientId}`;
	}

	private async getClient(config: LogAnalyticsConnectionConfiguration) {
		const key = this.clientKey(config);
		let client = this.clients.get(key);
		if (!client) {
			client = createStandardPublicClientApplication({
				auth: {
					clientId: config.clientId,
					authority: `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}`,
					redirectUri: new URL('/auth/callback', window.location.origin).toString()
				},
				cache: { cacheLocation: 'sessionStorage' }
			});
			this.clients.set(key, client);
		}
		return client;
	}

	private getAccount(
		client: IPublicClientApplication,
		config: LogAnalyticsConnectionConfiguration
	) {
		const account = config.account;
		if (!account) return undefined;
		return (
			client.getAccount({
				homeAccountId: account.homeAccountId,
				localAccountId: account.localAccountId,
				tenantId: account.tenantId
			}) ?? undefined
		);
	}

	toBinding(account: AccountInfo): LogAnalyticsAccountBinding {
		return {
			homeAccountId: account.homeAccountId,
			localAccountId: account.localAccountId,
			tenantId: account.tenantId,
			username: account.username,
			name: account.name
		};
	}

	async getAccountForConnection(config: LogAnalyticsConnectionConfiguration) {
		return this.getAccount(await this.getClient(config), config);
	}

	async signIn(config: LogAnalyticsConnectionConfiguration) {
		const key = this.clientKey(config);
		const existing = this.signInRequests.get(key);
		if (existing) return existing;
		const request = this.runInteractive(config, async () => {
			const client = await this.getClient(config);
			await this.clearAbandonedPopupInteraction(client, config, 'signout');
			const result = await client.loginPopup({
				scopes: [LOG_ANALYTICS_SCOPE],
				prompt: 'select_account'
			});
			client.setActiveAccount(result.account);
			return result;
		});
		this.signInRequests.set(key, request);
		try {
			return await request;
		} finally {
			if (this.signInRequests.get(key) === request) this.signInRequests.delete(key);
		}
	}

	/**
	 * MSAL writes one interaction marker in session storage. `handleRedirectPromise`
	 * is its public cleanup path when a popup interaction has been abandoned.
	 */
	private async clearAbandonedPopupInteraction(
		client: IPublicClientApplication,
		config: LogAnalyticsConnectionConfiguration,
		type: 'signin' | 'signout'
	) {
		const raw = window.sessionStorage?.getItem('msal.interaction.status');
		if (!raw) return;
		try {
			const interaction = JSON.parse(raw) as { clientId?: string; type?: string };
			if (interaction.clientId === config.clientId && interaction.type === type) {
				await client.handleRedirectPromise();
			}
		} catch {
			// Let MSAL surface malformed or active interaction state normally.
		}
	}

	/** Releases Kite's popup queue after the user stops waiting for an Entra logout popup. */
	async stopWaitingForSignOut(config: LogAnalyticsConnectionConfiguration) {
		const client = await this.getClient(config);
		const raw = window.sessionStorage?.getItem('msal.interaction.status');
		if (!raw) return;
		try {
			const interaction = JSON.parse(raw) as { clientId?: string; type?: string };
			if (interaction.clientId !== config.clientId || interaction.type !== 'signout') return;
			this.interactiveRequests.delete(this.clientKey(config));
			await client.handleRedirectPromise();
		} catch {
			// A future sign-in will surface any non-signout MSAL state normally.
		}
	}

	async signOutEverywhere(config: LogAnalyticsConnectionConfiguration) {
		const key = this.clientKey(config);
		return this.runInteractive(config, async () => {
			const client = await this.getClient(config);
			// A parent-page reload can orphan a completed sign-in popup while its
			// session-storage marker remains. Resolve that stale marker before the
			// logout popup asks MSAL to begin another interaction.
			await this.clearAbandonedPopupInteraction(client, config, 'signin');
			const account = this.getAccount(client, config);
			try {
				if (!account) return;
				const logoutHint = account.idTokenClaims?.login_hint;
				await client.logoutPopup({
					account,
					...(typeof logoutHint === 'string' ? { logoutHint } : {}),
					postLogoutRedirectUri: new URL('/auth/callback', window.location.origin).toString()
				});
			} finally {
				this.clearInMemorySession(key, config.account?.homeAccountId);
			}
		});
	}

	/** Clears another Kite client's local MSAL cache without opening a second logout popup. */
	async clearAccountCache(config: LogAnalyticsConnectionConfiguration) {
		const key = this.clientKey(config);
		const client = await this.getClient(config);
		const account = this.getAccount(client, config);
		try {
			if (account) await client.clearCache({ account });
		} finally {
			this.clearInMemorySession(key, config.account?.homeAccountId);
		}
	}

	async acquireToken(config: LogAnalyticsConnectionConfiguration) {
		const client = await this.getClient(config);
		let account = this.getAccount(client, config);
		let initialToken: string | undefined;
		if (!account) {
			const result = await this.signIn(config);
			account = result.account;
			initialToken = result.accessToken;
			config.account = this.toBinding(account);
		}
		if (initialToken) return initialToken;

		const key = `${this.clientKey(config)}\0${account.homeAccountId}`;
		const existing = this.tokenRequests.get(key);
		if (existing) return existing;
		const request = this.acquireTokenOnce(config, client, account);
		this.tokenRequests.set(key, request);
		try {
			return await request;
		} finally {
			if (this.tokenRequests.get(key) === request) this.tokenRequests.delete(key);
		}
	}

	private async acquireTokenOnce(
		config: LogAnalyticsConnectionConfiguration,
		client: IPublicClientApplication,
		account: AccountInfo
	) {
		try {
			const result = await client.acquireTokenSilent({ scopes: [LOG_ANALYTICS_SCOPE], account });
			client.setActiveAccount(result.account);
			return result.accessToken;
		} catch (error) {
			if (!(error instanceof InteractionRequiredAuthError)) throw error;
			const result = await this.runInteractive(config, () =>
				client.acquireTokenPopup({
					scopes: [LOG_ANALYTICS_SCOPE],
					account
				})
			);
			client.setActiveAccount(result.account);
			return result.accessToken;
		}
	}

	private clearInMemorySession(clientKey: string, homeAccountId?: string) {
		this.clients.delete(clientKey);
		if (homeAccountId) this.tokenRequests.delete(`${clientKey}\0${homeAccountId}`);
	}

	/** Serializes every MSAL popup for one tenant/client pair instead of cancelling another flow. */
	private runInteractive<T>(
		config: LogAnalyticsConnectionConfiguration,
		operation: () => Promise<T>
	): Promise<T> {
		const key = this.clientKey(config);
		const existing = this.interactiveRequests.get(key);
		if (existing) {
			return existing.catch(() => undefined).then(() => this.runInteractive(config, operation));
		}

		const request = operation();
		this.interactiveRequests.set(key, request);
		void request.then(
			() => {
				if (this.interactiveRequests.get(key) === request) this.interactiveRequests.delete(key);
			},
			() => {
				if (this.interactiveRequests.get(key) === request) this.interactiveRequests.delete(key);
			}
		);
		return request;
	}
}

export const logAnalyticsSessionManager = new LogAnalyticsSessionManager();
