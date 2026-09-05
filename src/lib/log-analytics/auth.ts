import type { AccountInfo } from '@azure/msal-browser';

import type {
	LogAnalyticsAccountBinding,
	LogAnalyticsConnectionConfiguration
} from '$lib/kusto/query-client';
import {
	AZURE_AUTHENTICATION_PROFILE_ACCOUNT_EVENT,
	AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY
} from '$lib/azure-auth/profile-store.svelte';
import { azureMsalClientManager as logAnalyticsSessionManager } from '$lib/azure-auth/msal-client-manager';

const LEGACY_AZURE_SESSIONS_STORAGE_KEY = 'kite:azure-sessions:v1';

type StoredAzureAuthenticationProfile = {
	id?: string;
	tenantId?: string;
	clientId?: string;
	account?: LogAnalyticsAccountBinding;
};

function resolveAzureAuthenticationProfile(config: LogAnalyticsConnectionConfiguration) {
	if (!config.authenticationProfileId || typeof localStorage === 'undefined') return config;
	try {
		const profiles = JSON.parse(
			localStorage.getItem(AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY) ??
				localStorage.getItem(LEGACY_AZURE_SESSIONS_STORAGE_KEY) ??
				'[]'
		) as StoredAzureAuthenticationProfile[];
		const profile = profiles.find((item) => item.id === config.authenticationProfileId);
		if (!profile?.tenantId || !profile.clientId) return config;
		config.tenantId = profile.tenantId;
		config.clientId = profile.clientId;
		config.account = profile.account;
	} catch {}
	return config;
}

function persistAuthenticationProfileAccount(config: LogAnalyticsConnectionConfiguration) {
	if (!config.authenticationProfileId || typeof window === 'undefined') return;
	window.dispatchEvent(
		new CustomEvent(AZURE_AUTHENTICATION_PROFILE_ACCOUNT_EVENT, {
			detail: { id: config.authenticationProfileId, account: config.account }
		})
	);
}

/** Compatibility facade for Log Analytics authentication callers. */
export const LOG_ANALYTICS_SCOPE = 'https://api.loganalytics.io/.default';

export function toLogAnalyticsAccountBinding(account: AccountInfo): LogAnalyticsAccountBinding {
	return logAnalyticsSessionManager.toBinding(account);
}

export function getLogAnalyticsAccount(config: LogAnalyticsConnectionConfiguration) {
	return logAnalyticsSessionManager.getAccountForConnection(
		resolveAzureAuthenticationProfile(config)
	);
}

export async function connectLogAnalytics(config: LogAnalyticsConnectionConfiguration) {
	const result = await logAnalyticsSessionManager.signIn(resolveAzureAuthenticationProfile(config));
	config.account = toLogAnalyticsAccountBinding(result.account);
	persistAuthenticationProfileAccount(config);
	return result;
}

export function logoutLogAnalytics(config: LogAnalyticsConnectionConfiguration) {
	return logAnalyticsSessionManager.signOutEverywhere(resolveAzureAuthenticationProfile(config));
}

export async function acquireLogAnalyticsToken(config: LogAnalyticsConnectionConfiguration) {
	const token = await logAnalyticsSessionManager.acquireToken(
		resolveAzureAuthenticationProfile(config)
	);
	persistAuthenticationProfileAccount(config);
	return token;
}
