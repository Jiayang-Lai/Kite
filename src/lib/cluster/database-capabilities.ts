import {
	getConnectionCapabilities,
	type DatabaseCapabilities
} from '$lib/cluster/connection-capabilities';
import type { KustoClusterConnection } from '$lib/kusto/query-client';

export type { DatabaseCapabilities };

export function getDatabaseCapabilities(
	cluster: KustoClusterConnection | undefined
): DatabaseCapabilities {
	return getConnectionCapabilities(cluster).databases;
}
