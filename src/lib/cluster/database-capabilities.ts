import {
	getConnectionCapabilities,
	type DatabaseCapabilities
} from '$lib/cluster/connection-capabilities';
import type { KustoClusterConnection } from '$lib/cluster/connections';

export type { DatabaseCapabilities };

export function getDatabaseCapabilities(
	cluster: KustoClusterConnection | undefined
): DatabaseCapabilities {
	return getConnectionCapabilities(cluster).databases;
}
