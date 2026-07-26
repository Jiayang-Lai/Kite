import { describe, expect, it } from 'vitest';

import {
	createStarterMockSchema,
	getMockClusterSchema,
	normalizeMockSchema,
	usesBuiltInMockCatalog
} from './mock-cluster-schema';

describe('mock cluster schemas', () => {
	it('creates a fresh starter schema for each cluster', () => {
		const first = createStarterMockSchema();
		const second = createStarterMockSchema();

		expect(first).toEqual({
			Database: {
				name: 'Database',
				tables: [],
				functions: []
			}
		});
		expect(first).not.toBe(second);
		expect(first.Database).not.toBe(second.Database);
	});

	it('validates and clones user-authored schema metadata', () => {
		const source = {
			Analytics: {
				name: 'Analytics',
				tables: [
					{
						name: 'Events',
						columns: [{ name: 'Timestamp', type: 'datetime' }]
					}
				]
			}
		};

		const schema = normalizeMockSchema(source);

		expect(schema).toEqual(source);
		expect(schema).not.toBe(source);
		expect(schema.Analytics).not.toBe(source.Analytics);
	});

	it.each([
		[{}, 'at least one database'],
		[{ WrongKey: { name: 'Database', tables: [] } }, 'must match its name'],
		[{ Database: { name: 'Database' } }, 'tables must be an array'],
		[
			{ Database: { name: 'Database', tables: [{ name: 'Events', columns: [{}] }] } },
			'.name must be a non-empty string'
		]
	])('rejects invalid schema metadata %#', (schema, message) => {
		expect(() => normalizeMockSchema(schema)).toThrow(message);
	});

	it('uses private schemas without changing the built-in mock catalog behavior', () => {
		const privateSchema = createStarterMockSchema();
		const customCluster = {
			id: 'custom',
			name: 'Custom',
			url: 'mock://kite/custom',
			kind: 'mock' as const,
			mockSchema: privateSchema
		};
		const builtInCluster = {
			id: 'built-in',
			name: 'Built in',
			url: 'mock://kite',
			kind: 'mock' as const
		};

		expect(getMockClusterSchema(customCluster)).toEqual(privateSchema);
		expect(getMockClusterSchema(customCluster)).not.toBe(privateSchema);
		expect(usesBuiltInMockCatalog(customCluster)).toBe(false);
		expect(usesBuiltInMockCatalog(builtInCluster)).toBe(true);
		expect(getMockClusterSchema(builtInCluster)).toHaveProperty('Samples');
	});

	it('returns a worker-transferable snapshot when Svelte proxies the stored schema', () => {
		const proxiedSchema = new Proxy(createStarterMockSchema(), {});
		const proxiedCluster = new Proxy(
			{
				id: 'proxied',
				name: 'Proxied',
				url: 'mock://kite/proxied',
				kind: 'mock' as const,
				mockSchema: proxiedSchema
			},
			{}
		);

		const resolvedSchema = getMockClusterSchema(proxiedCluster);

		expect(resolvedSchema).toEqual(proxiedSchema);
		expect(() => structuredClone(resolvedSchema)).not.toThrow();
	});
});
