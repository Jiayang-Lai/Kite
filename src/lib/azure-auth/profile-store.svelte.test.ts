import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY,
	type AzureAuthenticationProfileStore,
	createAzureAuthenticationProfileStore
} from './profile-store.svelte';

const LEGACY_STORAGE_KEY = 'kite:azure-sessions:v1';
let uuidSequence = 0;
let stores: AzureAuthenticationProfileStore[] = [];
const account = {
	homeAccountId: 'home-account',
	localAccountId: 'local-account',
	tenantId: 'tenant',
	username: 'person@example.test',
	name: 'Person'
};

function storedProfile(id = 'profile') {
	return {
		id,
		name: 'Production',
		tenantId: 'tenant',
		clientId: 'client'
	};
}

function createStore() {
	const store = createAzureAuthenticationProfileStore();
	stores.push(store);
	return store;
}

beforeEach(() => {
	localStorage.clear();
	uuidSequence = 0;
	vi.spyOn(crypto, 'randomUUID').mockImplementation(
		() =>
			`00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`
	);
});

afterEach(() => {
	for (const store of stores) store.dispose();
	stores = [];
	vi.restoreAllMocks();
});

describe('Azure authentication profile store', () => {
	it('hydrates valid current profiles once and ignores invalid entries', () => {
		localStorage.setItem(
			AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY,
			JSON.stringify([storedProfile(), { id: 'incomplete' }])
		);
		const store = createStore();

		store.hydrate();
		localStorage.setItem(AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY, '[]');
		store.hydrate();

		expect(store.profiles).toEqual([storedProfile()]);
	});

	it('migrates valid legacy profiles and tolerates malformed storage', () => {
		localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify([storedProfile('legacy')]));
		const migrated = createStore();
		migrated.hydrate();

		expect(migrated.profiles).toEqual([storedProfile('legacy')]);
		expect(
			JSON.parse(localStorage.getItem(AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY) ?? '[]')
		).toEqual([storedProfile('legacy')]);

		localStorage.setItem(AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY, '{invalid json');
		const malformed = createStore();
		malformed.hydrate();
		expect(malformed.profiles).toEqual([]);
	});

	it('adds and removes profiles while publishing the removal event', () => {
		const removed = vi.fn();
		window.addEventListener('kite:azure-authentication-profile-removed', removed, { once: true });
		const store = createStore();

		const profile = store.add({ name: 'Production', tenantId: 'tenant', clientId: 'client' });
		expect(profile.id).toBe('00000000-0000-4000-8000-000000000001');
		expect(
			JSON.parse(localStorage.getItem(AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY) ?? '[]')
		).toEqual([profile]);

		store.remove(profile.id);
		expect(store.profiles).toEqual([]);
		expect(removed).toHaveBeenCalledOnce();
		expect((removed.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: profile.id });
	});

	it('binds and clears accounts by profile and shared account identity', () => {
		const store = createStore();
		const first = store.add({ name: 'First', tenantId: 'tenant', clientId: 'one' });
		const second = store.add({ name: 'Second', tenantId: 'tenant', clientId: 'two' });

		store.bindAccount(first.id, account);
		store.bindAccount(second.id, account);
		expect(store.profiles.map((profile) => profile.account)).toEqual([account, account]);

		store.clearAccount(first.id);
		expect(store.profiles.find((profile) => profile.id === first.id)?.account).toBeUndefined();
		expect(store.profiles.find((profile) => profile.id === second.id)?.account).toEqual(account);

		store.clearAccountBindings(account);
		expect(store.profiles.every((profile) => profile.account === undefined)).toBe(true);
	});

	it('accepts account updates dispatched by the authentication callback', () => {
		const store = createStore();
		const profile = store.add({ name: 'Production', tenantId: 'tenant', clientId: 'client' });

		window.dispatchEvent(
			new CustomEvent('kite:azure-authentication-profile-account', {
				detail: { id: profile.id, account }
			})
		);

		expect(store.profiles[0].account).toEqual(account);
	});

	it('stops listening for account updates after disposal', () => {
		const store = createStore();
		const profile = store.add({ name: 'Production', tenantId: 'tenant', clientId: 'client' });
		store.dispose();

		window.dispatchEvent(
			new CustomEvent('kite:azure-authentication-profile-account', {
				detail: { id: profile.id, account }
			})
		);

		expect(store.profiles[0].account).toBeUndefined();
	});
});
