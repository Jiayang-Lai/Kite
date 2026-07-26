import type { KustoClusterConnection } from '$lib/kusto/query-client';
import type {
	ExplorerExpansionChange,
	ExplorerExpansionState
} from '$lib/cluster/cluster-session.svelte';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

export type ExplorerQuery = {
	/** Optional persistent identity used by locally saved queries. */
	id?: string;
	/** Short label shown in a saved or recent query list. */
	name: string;
	/** Database context in which the query should run. */
	database: string;
	/** KQL source restored when the query is selected. */
	query: string;
};

export type ExplorerSelection = {
	database: string;
	table?: string;
	function?: string;
};

export type ClusterSwitcherProps = {
	clusters: KustoClusterConnection[];
	selectedClusterId: string;
	showCluster: boolean;
	disabled?: boolean;
	onclusterchange?: (clusterId: string) => void;
};

export type ClusterTreeProps = {
	databases: KustoDatabaseSchema;
	selectedDatabase: string;
	selectedTable?: string;
	selectedFunction?: string;
	filter: string;
	expansionState: ExplorerExpansionState;
	onexpansionchange: (change: ExplorerExpansionChange) => void;
	onselect?: (selection: ExplorerSelection) => void;
};
