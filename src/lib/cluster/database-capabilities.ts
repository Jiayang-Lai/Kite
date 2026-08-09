import type { KustoClusterConnection } from '$lib/kusto/query-client';

export type DatabaseCapabilities = {
	create: boolean;
	drop: boolean;
	rename: 'canonical' | 'display-name' | false;
};

export function getDatabaseCapabilities(
	cluster: KustoClusterConnection | undefined
): DatabaseCapabilities {
	if (!cluster) return { create: false, drop: false, rename: false };
	if (cluster.kind === 'mock') return { create: true, drop: true, rename: 'canonical' };
	if (cluster.kind === 'emulated') return { create: true, drop: true, rename: false };
	if (cluster.kind === 'log-analytics') return { create: false, drop: false, rename: false };

	return {
		create: false,
		drop: false,
		rename: 'display-name'
	};
}
