import { browser } from '$app/environment';
import { getContext, setContext } from 'svelte';
import type { LogAnalyticsAccountBinding } from '$lib/kusto/query-client';

export type AzureAuthenticationProfile = {
	id: string;
	name: string;
	tenantId: string;
	clientId: string;
	account?: LogAnalyticsAccountBinding;
};

const CONTEXT = Symbol('azure-authentication-profile-store');
export const AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY = 'kite:azure-authentication-profiles:v1';
export const AZURE_AUTHENTICATION_PROFILE_ACCOUNT_EVENT =
	'kite:azure-authentication-profile-account';
const LEGACY_AZURE_SESSIONS_STORAGE_KEY = 'kite:azure-sessions:v1';

export type AzureAuthenticationProfileStore = {
	readonly profiles: AzureAuthenticationProfile[];
	hydrate: () => void;
	add: (profile: Omit<AzureAuthenticationProfile, 'id'>) => AzureAuthenticationProfile;
	remove: (id: string) => void;
	bindAccount: (id: string, account: LogAnalyticsAccountBinding) => void;
	clearAccount: (id: string) => void;
	clearAccountBindings: (account: LogAnalyticsAccountBinding) => void;
	dispose: () => void;
};

function isProfile(value: unknown): value is AzureAuthenticationProfile {
	return (
		!!value &&
		typeof value === 'object' &&
		typeof (value as AzureAuthenticationProfile).id === 'string' &&
		typeof (value as AzureAuthenticationProfile).name === 'string' &&
		typeof (value as AzureAuthenticationProfile).tenantId === 'string' &&
		typeof (value as AzureAuthenticationProfile).clientId === 'string'
	);
}

export function createAzureAuthenticationProfileStore(): AzureAuthenticationProfileStore {
	let profiles = $state<AzureAuthenticationProfile[]>([]);
	let hydrated = false;
	function persist(next: AzureAuthenticationProfile[]) {
		if (browser)
			localStorage.setItem(AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY, JSON.stringify(next));
	}
	const acceptAccountUpdate = (event: Event) => {
		const detail = (event as CustomEvent<{ id: string; account?: LogAnalyticsAccountBinding }>)
			.detail;
		if (!detail) return;
		const next = profiles.map((profile) =>
			profile.id === detail.id ? { ...profile, account: detail.account } : profile
		);
		persist(next);
		profiles = next;
	};
	if (browser)
		window.addEventListener(AZURE_AUTHENTICATION_PROFILE_ACCOUNT_EVENT, acceptAccountUpdate);
	return {
		get profiles() {
			return profiles;
		},
		hydrate() {
			if (!browser || hydrated) return;
			hydrated = true;
			try {
				const current = localStorage.getItem(AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY);
				const value: unknown = JSON.parse(
					current ?? localStorage.getItem(LEGACY_AZURE_SESSIONS_STORAGE_KEY) ?? '[]'
				);
				if (!Array.isArray(value)) return;
				profiles = value.filter(isProfile);
				if (!current) persist(profiles);
			} catch {}
		},
		add(draft) {
			const profile = { ...draft, id: crypto.randomUUID() };
			const next = [...profiles, profile];
			persist(next);
			profiles = next;
			return profile;
		},
		remove(id) {
			const next = profiles.filter((profile) => profile.id !== id);
			persist(next);
			profiles = next;
			if (browser)
				window.dispatchEvent(
					new CustomEvent('kite:azure-authentication-profile-removed', { detail: { id } })
				);
		},
		bindAccount(id, account) {
			const next = profiles.map((profile) =>
				profile.id === id ? { ...profile, account } : profile
			);
			persist(next);
			profiles = next;
		},
		clearAccount(id) {
			const next = profiles.map((profile) =>
				profile.id === id ? { ...profile, account: undefined } : profile
			);
			persist(next);
			profiles = next;
		},
		clearAccountBindings(account) {
			const next = profiles.map((profile) =>
				profile.account?.homeAccountId === account.homeAccountId &&
				profile.account.tenantId === account.tenantId
					? { ...profile, account: undefined }
					: profile
			);
			persist(next);
			profiles = next;
		},
		dispose() {
			if (browser)
				window.removeEventListener(AZURE_AUTHENTICATION_PROFILE_ACCOUNT_EVENT, acceptAccountUpdate);
		}
	};
}

export function setAzureAuthenticationProfileStore(store: AzureAuthenticationProfileStore) {
	setContext(CONTEXT, store);
}
export function getAzureAuthenticationProfileStore() {
	const store = getContext<AzureAuthenticationProfileStore>(CONTEXT);
	if (!store) throw new Error('Azure authentication profile store has not been initialized.');
	return store;
}
