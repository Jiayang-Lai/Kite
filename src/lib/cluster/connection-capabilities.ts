import type { KustoClusterConnection } from '$lib/kusto/query-client';

export type DatabaseCapabilities = {
	create: boolean;
	drop: boolean;
	rename: 'canonical' | 'display-name' | false;
};

export type ConnectionCapabilities = {
	schemaLoader: 'backend' | 'emulated' | 'log-analytics' | 'mock';
	queryExecutor: 'emulated' | 'kusto' | 'log-analytics' | 'none';
	managementCommands: boolean;
	databases: DatabaseCapabilities;
	ingestion: 'emulated' | 'kustainer' | 'none';
};

const NO_DATABASE_CAPABILITIES: DatabaseCapabilities = {
	create: false,
	drop: false,
	rename: false
};

/**
 * Resolves the features exposed by a connection without hiding the
 * connection-specific configuration needed to perform those operations.
 */
export function getConnectionCapabilities(
	cluster: KustoClusterConnection | undefined
): ConnectionCapabilities {
	if (!cluster) {
		return {
			schemaLoader: 'backend',
			queryExecutor: 'none',
			managementCommands: false,
			databases: NO_DATABASE_CAPABILITIES,
			ingestion: 'none'
		};
	}

	switch (cluster.kind) {
		case 'mock':
			return {
				schemaLoader: 'mock',
				queryExecutor: 'none',
				managementCommands: false,
				databases: { create: true, drop: true, rename: 'canonical' },
				ingestion: 'none'
			};
		case 'emulated':
			return {
				schemaLoader: 'emulated',
				queryExecutor: 'emulated',
				managementCommands: false,
				databases: { create: true, drop: true, rename: false },
				ingestion: 'emulated'
			};
		case 'log-analytics':
			return {
				schemaLoader: 'log-analytics',
				queryExecutor: 'log-analytics',
				managementCommands: false,
				databases: NO_DATABASE_CAPABILITIES,
				ingestion: 'none'
			};
		case 'remote':
			return {
				schemaLoader: 'backend',
				queryExecutor: 'kusto',
				managementCommands: true,
				databases: { create: false, drop: false, rename: 'display-name' },
				ingestion: cluster.ingestion ? 'kustainer' : 'none'
			};
	}
}
