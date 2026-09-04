import { describe, expect, it } from 'vitest';

import type {
	EmulatedClusterConnection,
	KustoClusterConnection,
	LogAnalyticsClusterConnection,
	MockClusterConnection,
	RemoteClusterConnection
} from './connections';
import { getConnectionCapabilities } from './connection-capabilities';

function connection(kind: 'remote'): RemoteClusterConnection;
function connection(kind: 'log-analytics'): LogAnalyticsClusterConnection;
function connection(kind: 'mock'): MockClusterConnection;
function connection(kind: 'emulated'): EmulatedClusterConnection;
function connection(kind: KustoClusterConnection['kind']): KustoClusterConnection;
function connection(kind: KustoClusterConnection['kind']): KustoClusterConnection {
	switch (kind) {
		case 'remote':
			return { id: kind, name: kind, url: 'https://example.test', kind };
		case 'log-analytics':
			return {
				id: kind,
				name: kind,
				url: 'https://api.loganalytics.azure.com',
				kind,
				logAnalytics: {
					workspaceId: 'workspace-id',
					tenantId: 'tenant-id',
					clientId: 'client-id'
				}
			};
		case 'mock':
			return { id: kind, name: kind, url: 'mock://kite', kind };
		case 'emulated':
			return {
				id: kind,
				name: kind,
				url: 'emulated://kite',
				kind,
				emulatedStorage: { mode: 'memory' }
			};
	}
}

describe('getConnectionCapabilities', () => {
	it('returns no available operations without a connection', () => {
		expect(getConnectionCapabilities(undefined)).toMatchObject({
			queryExecutor: 'none',
			managementCommands: false,
			ingestion: 'none',
			databases: { create: false, drop: false, rename: false }
		});
	});

	it.each([
		['mock', 'mock', 'none', false, 'none', { create: true, drop: true, rename: 'canonical' }],
		[
			'emulated',
			'emulated',
			'emulated',
			false,
			'emulated',
			{ create: true, drop: true, rename: false }
		],
		[
			'log-analytics',
			'log-analytics',
			'log-analytics',
			false,
			'none',
			{ create: false, drop: false, rename: false }
		],
		[
			'remote',
			'backend',
			'kusto',
			true,
			'none',
			{ create: false, drop: false, rename: 'display-name' }
		]
	] as const)(
		'defines the %s feature set',
		(kind, schemaLoader, queryExecutor, managementCommands, ingestion, databases) => {
			expect(getConnectionCapabilities(connection(kind))).toEqual({
				schemaLoader,
				queryExecutor,
				managementCommands,
				ingestion,
				databases
			});
		}
	);

	it('enables Kustainer ingestion only when configured on a remote connection', () => {
		const cluster = connection('remote');
		cluster.ingestion = {
			mode: 'kustainer',
			containerRoot: '/kustodata/raw',
			maxInlineFileBytes: 1,
			maxInlineCommandBytes: 1
		};
		expect(getConnectionCapabilities(cluster).ingestion).toBe('kustainer');
	});
});
