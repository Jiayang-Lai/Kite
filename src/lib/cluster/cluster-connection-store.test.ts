import { describe, expect, it } from 'vitest';

import { createClusterConnectionStore } from './cluster-connection-store.svelte';

describe('cluster connection store', () => {
	it('adds a normalized remote connection after the built-in catalog', () => {
		const store = createClusterConnectionStore();
		const builtInCount = store.clusters.length;

		const cluster = store.add({
			name: '  Analytics  ',
			kind: 'remote',
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

	it('adds a Log Analytics connection without persisting credentials', () => {
		const store = createClusterConnectionStore();
		const cluster = store.add({
			name: ' Production logs ',
			kind: 'log-analytics',
			workspaceId: 'A0A0A0A0-BBBB-4CCC-8DDD-E1E1E1E1E1E1',
			workspaceResourceId:
				'/subscriptions/011424d1-c061-4342-86be-bcf0a8b023ab/resourceGroups/rg-kite-observability/providers/Microsoft.OperationalInsights/workspaces/kite-logs',
			tenantId: 'Contoso.OnMicrosoft.com',
			clientId: 'B0B0B0B0-BBBB-4CCC-8DDD-E1E1E1E1E1E1',
			defaultTimespan: 'pt24h'
		});

		expect(cluster).toMatchObject({
			name: 'Production logs',
			kind: 'log-analytics',
			url: 'https://api.loganalytics.azure.com',
			logAnalytics: {
				workspaceId: 'a0a0a0a0-bbbb-4ccc-8ddd-e1e1e1e1e1e1',
				workspaceResourceId:
					'/subscriptions/011424d1-c061-4342-86be-bcf0a8b023ab/resourceGroups/rg-kite-observability/providers/Microsoft.OperationalInsights/workspaces/kite-logs',
				tenantId: 'contoso.onmicrosoft.com',
				clientId: 'b0b0b0b0-bbbb-4ccc-8ddd-e1e1e1e1e1e1',
				defaultTimespan: 'PT24H'
			}
		});
		expect(JSON.stringify(cluster)).not.toContain('secret');
	});

	it('adds a mock connection backed by the in-memory catalog', () => {
		const store = createClusterConnectionStore();

		const cluster = store.add({
			name: '  Demo catalog  ',
			kind: 'mock',
			description: '  Local sample data  ',
			mockSchema: {
				Demo: {
					name: 'Demo',
					tables: [
						{
							name: 'Events',
							columns: [{ name: 'Timestamp', type: 'datetime' }]
						}
					]
				}
			}
		});

		expect(cluster).toMatchObject({
			name: 'Demo catalog',
			description: 'Local sample data',
			kind: 'mock',
			mockSchema: {
				Demo: {
					name: 'Demo',
					tables: [
						{
							name: 'Events',
							columns: [{ name: 'Timestamp', type: 'datetime' }]
						}
					]
				}
			}
		});
		expect(cluster.url).toBe(`mock://kite/${cluster.id}`);
	});

	it('adds an isolated browser-emulated connection without a remote URL', () => {
		const store = createClusterConnectionStore();

		const cluster = store.add({
			name: '  Local DuckDB  ',
			kind: 'emulated',
			description: '  Runs in this tab  ',
			storageMode: 'opfs'
		});

		expect(cluster).toMatchObject({
			name: 'Local DuckDB',
			description: 'Runs in this tab',
			kind: 'emulated',
			emulatedStorage: {
				mode: 'opfs',
				storageId: cluster.id,
				formatVersion: 1
			}
		});
		expect(cluster.url).toBe(`emulated://kite/${cluster.id}`);
	});

	it('defaults custom emulated connections to persistent browser storage', () => {
		const store = createClusterConnectionStore();
		const cluster = store.add({
			name: 'Persistent DuckDB',
			kind: 'emulated'
		});

		expect(cluster.emulatedStorage).toEqual({
			mode: 'opfs',
			storageId: cluster.id,
			formatVersion: 1
		});
	});

	it('does not change an emulated cluster storage mode after creation', () => {
		const store = createClusterConnectionStore();
		const cluster = store.add({
			name: 'Persistent DuckDB',
			kind: 'emulated',
			storageMode: 'opfs'
		});

		expect(() =>
			store.update(cluster.id, {
				name: cluster.name,
				kind: 'emulated',
				storageMode: 'memory'
			})
		).toThrow('storage cannot be changed');
	});

	it('keeps custom mock schemas independent', () => {
		const store = createClusterConnectionStore();
		const sharedDraftSchema = {
			Database: {
				name: 'Database',
				tables: []
			}
		};
		const first = store.add({
			name: 'First mock',
			kind: 'mock',
			mockSchema: sharedDraftSchema
		});
		const second = store.add({
			name: 'Second mock',
			kind: 'mock',
			mockSchema: sharedDraftSchema
		});

		expect(first.url).not.toBe(second.url);
		expect(first.mockSchema).not.toBe(second.mockSchema);

		const updatedFirst = store.update(first.id, {
			name: first.name,
			kind: 'mock',
			mockSchema: {
				Database: {
					name: 'Database',
					tables: [{ name: 'OnlyInFirst', columns: [] }]
				}
			}
		});

		expect(updatedFirst.mockSchema?.Database.tables).toHaveLength(1);
		expect(second.mockSchema?.Database.tables).toEqual([]);
	});

	it('updates mock schemas with optimistic revision checks', () => {
		const store = createClusterConnectionStore();
		const mock = store.clusters.find((cluster) => cluster.kind === 'mock')!;
		const revision = mock.mockSchemaRevision ?? 0;

		const updated = store.updateMockSchema(mock.id, revision, (schema) => ({
			...schema,
			Local: {
				name: 'Local',
				tables: []
			}
		}));

		expect(updated.mockSchemaRevision).toBe(revision + 1);
		expect(updated.mockSchema).toHaveProperty('Local');
		expect(() => store.updateMockSchema(mock.id, revision, (schema) => schema)).toThrow(
			'changed while this editor was open'
		);
	});

	it.each(['not a url', 'ftp://example.test', 'https://user:secret@example.test'])(
		'rejects unsupported endpoint %s',
		(url) => {
			const store = createClusterConnectionStore();

			expect(() => store.add({ name: 'Invalid', kind: 'remote', url })).toThrow();
		}
	);

	it('updates and removes custom connections', () => {
		const store = createClusterConnectionStore();
		const cluster = store.add({
			name: 'Original',
			kind: 'remote',
			url: 'https://original.example.test'
		});

		const updated = store.update(cluster.id, {
			name: 'Updated',
			kind: 'remote',
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
			store.update(builtIn.id, {
				name: 'Changed',
				kind: 'remote',
				url: 'https://example.test'
			})
		).toThrow('Built-in clusters cannot be edited.');
		expect(() => store.remove(builtIn.id)).toThrow('Built-in clusters cannot be removed.');
	});
});
