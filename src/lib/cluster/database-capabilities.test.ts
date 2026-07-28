import { describe, expect, it } from 'vitest';

import type { KustoClusterConnection } from '$lib/kusto/query-client';
import { getDatabaseCapabilities } from './database-capabilities';

const remoteCluster: KustoClusterConnection = {
	id: 'remote',
	name: 'Remote',
	url: 'https://example.kusto.windows.net',
	kind: 'remote'
};

describe('getDatabaseCapabilities', () => {
	it('supports all browser-local mock database mutations', () => {
		expect(
			getDatabaseCapabilities({
				id: 'mock',
				name: 'Mock',
				url: 'mock://kite/mock',
				kind: 'mock'
			})
		).toEqual({ create: true, drop: true, rename: 'canonical' });
	});

	it('keeps local-backend remote canonical names stable', () => {
		expect(getDatabaseCapabilities(remoteCluster)).toEqual({
			create: false,
			drop: false,
			rename: 'display-name'
		});
	});

	it('supports DuckDB database creation and deletion without claiming rename support', () => {
		expect(
			getDatabaseCapabilities({
				id: 'emulated',
				name: 'Emulated',
				url: 'emulated://kite',
				kind: 'emulated'
			})
		).toEqual({ create: true, drop: true, rename: false });
	});
});
