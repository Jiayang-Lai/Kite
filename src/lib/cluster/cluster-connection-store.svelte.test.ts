import { beforeEach, describe, expect, it } from 'vitest';

import { createClusterConnectionStore } from './cluster-connection-store.svelte';

const STORAGE_KEY = 'kite:cluster-connections:v1';

const storedRemoteCluster = {
	id: 'stored-remote',
	name: 'Stored remote',
	description: 'Restored from local storage',
	url: 'https://stored.example.test',
	kind: 'remote' as const
};

beforeEach(() => localStorage.clear());

describe('cluster connection store browser hydration', () => {
	it('publishes readiness after restoring valid custom connections', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([storedRemoteCluster]));
		const store = createClusterConnectionStore();

		expect(store.hydrated).toBe(false);
		store.hydrate();

		expect(store.hydrated).toBe(true);
		expect(store.customClusters).toEqual([storedRemoteCluster]);
	});

	it('ignores malformed and invalid stored connections while becoming ready', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify([storedRemoteCluster, { id: 'invalid', name: 'Missing endpoint' }])
		);
		const store = createClusterConnectionStore();

		store.hydrate();

		expect(store.hydrated).toBe(true);
		expect(store.customClusters).toEqual([storedRemoteCluster]);

		localStorage.setItem(STORAGE_KEY, '{not valid JSON');
		const malformedStore = createClusterConnectionStore();
		malformedStore.hydrate();
		expect(malformedStore.hydrated).toBe(true);
		expect(malformedStore.customClusters).toEqual([]);
	});

	it('hydrates only once even if browser storage changes later', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([storedRemoteCluster]));
		const store = createClusterConnectionStore();
		store.hydrate();

		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify([{ ...storedRemoteCluster, id: 'replacement', name: 'Replacement' }])
		);
		store.hydrate();

		expect(store.customClusters).toEqual([storedRemoteCluster]);
	});
});
