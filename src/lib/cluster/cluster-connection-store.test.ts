import { describe, expect, it } from 'vitest';

import { createClusterConnectionStore } from './cluster-connection-store.svelte';

describe('cluster connection store', () => {
	it('adds a normalized remote connection after the built-in catalog', () => {
		const store = createClusterConnectionStore();
		const builtInCount = store.clusters.length;

		const cluster = store.add({
			name: '  Analytics  ',
			url: 'https://example.kusto.windows.net/?ignored=true#fragment',
			description: '  Production data  '
		});

		expect(store.clusters).toHaveLength(builtInCount + 1);
		expect(store.clusters.at(-1)).toEqual(cluster);
		expect(cluster).toMatchObject({
			name: 'Analytics',
			url: 'https://example.kusto.windows.net',
			description: 'Production data',
			kind: 'remote'
		});
	});

	it.each(['not a url', 'ftp://example.test', 'https://user:secret@example.test'])(
		'rejects unsupported endpoint %s',
		(url) => {
			const store = createClusterConnectionStore();

			expect(() => store.add({ name: 'Invalid', url })).toThrow();
		}
	);

	it('updates and removes custom connections', () => {
		const store = createClusterConnectionStore();
		const cluster = store.add({ name: 'Original', url: 'https://original.example.test' });

		const updated = store.update(cluster.id, {
			name: 'Updated',
			url: 'https://updated.example.test',
			description: 'New endpoint'
		});

		expect(updated.id).toBe(cluster.id);
		expect(store.customClusters).toEqual([updated]);
		expect(store.clusters.find((item) => item.id === cluster.id)).toEqual(updated);

		store.remove(cluster.id);

		expect(store.customClusters).toEqual([]);
		expect(store.clusters.some((item) => item.id === cluster.id)).toBe(false);
	});

	it('protects built-in connections from changes', () => {
		const store = createClusterConnectionStore();
		const builtIn = store.clusters[0];

		expect(() =>
			store.update(builtIn.id, { name: 'Changed', url: 'https://example.test' })
		).toThrow('Built-in clusters cannot be edited.');
		expect(() => store.remove(builtIn.id)).toThrow('Built-in clusters cannot be removed.');
	});
});
