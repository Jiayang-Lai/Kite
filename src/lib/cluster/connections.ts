import type { EmulatedStorage } from '$lib/emulation/storage';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

/** Browser-visible endpoint for Kite's default Kusto connection. */
export const DEFAULT_KUSTO_CLUSTER_URL = 'http://localhost:8080';
/** Stable synthetic endpoint used to identify Kite's in-memory schema catalog. */
export const MOCK_KUSTO_CLUSTER_URL = 'mock://kite';
/** Stable synthetic endpoint used to identify Kite's in-browser DuckDB backend. */
export const EMULATED_KUSTO_CLUSTER_URL = 'emulated://kite';

export type KustoIngestionConfiguration = {
	/** Ingestion support exposed by this connection. */
	mode: 'kustainer';
	/** Absolute directory visible inside Kustainer that contains staged source files. */
	containerRoot: string;
	/** Largest browser-selected file accepted for chunked inline ingestion. */
	maxInlineFileBytes: number;
	/** Largest UTF-8 management command generated for one inline-file chunk. */
	maxInlineCommandBytes: number;
};

/** Browser-safe configuration for querying one Azure Log Analytics workspace. */
export type LogAnalyticsConnectionConfiguration = {
	/** Immutable workspace GUID shown in the Azure portal's Properties pane. */
	workspaceId: string;
	/** ARM resource ID of the workspace, used for resource-scoped metadata requests. */
	workspaceResourceId?: string;
	/** Microsoft Entra tenant ID or verified tenant domain for this workspace. */
	tenantId: string;
	/** Application (client) ID of a public SPA app registered in that tenant. */
	clientId: string;
	/** Optional ISO-8601 query window applied when the editor runs a query. */
	defaultTimespan?: string;
	/** Optional reusable Azure authentication profile selected for this workspace. */
	authenticationProfileId?: string;
	/** Account resolved from the linked Azure authentication profile at runtime; identifiers only, never tokens. */
	account?: LogAnalyticsAccountBinding;
};

export type LogAnalyticsAccountBinding = {
	homeAccountId: string;
	localAccountId: string;
	tenantId: string;
	username: string;
	name?: string;
};

type ClusterConnectionBase = {
	/** Stable identifier used to select this connection independently of its endpoint. */
	id: string;
	/** Human-readable label shown in the cluster selector. */
	name: string;
	/** Optional supporting detail shown beneath the connection name in the selector. */
	description?: string;
	/** Browser-accessible or synthetic cluster endpoint. */
	url: string;
};

export type RemoteClusterConnection = ClusterConnectionBase & {
	kind: 'remote';
	/** Optional ingestion behavior available for this connection. */
	ingestion?: KustoIngestionConfiguration;
	logAnalytics?: never;
	mockSchema?: never;
	mockSchemaRevision?: never;
	emulatedStorage?: never;
};

export type LogAnalyticsClusterConnection = ClusterConnectionBase & {
	kind: 'log-analytics';
	/** Authentication and workspace settings for an Azure Log Analytics connection. */
	logAnalytics: LogAnalyticsConnectionConfiguration;
	ingestion?: never;
	mockSchema?: never;
	mockSchemaRevision?: never;
	emulatedStorage?: never;
};

export type MockClusterConnection = ClusterConnectionBase & {
	kind: 'mock';
	/** Browser-local schema metadata owned by a custom mock connection. */
	mockSchema?: KustoDatabaseSchema;
	/** Optimistic concurrency token incremented after each browser-local schema mutation. */
	mockSchemaRevision?: number;
	ingestion?: never;
	logAnalytics?: never;
	emulatedStorage?: never;
};

export type EmulatedClusterConnection = ClusterConnectionBase & {
	kind: 'emulated';
	/** Persistence configuration owned by an in-browser emulated connection. */
	emulatedStorage: EmulatedStorage;
	ingestion?: never;
	logAnalytics?: never;
	mockSchema?: never;
	mockSchemaRevision?: never;
};

/** Validated connection configuration narrowed by its backend kind. */
export type KustoClusterConnection =
	| RemoteClusterConnection
	| LogAnalyticsClusterConnection
	| MockClusterConnection
	| EmulatedClusterConnection;

export type ClusterKind = KustoClusterConnection['kind'];
export type ClusterConnectionOfKind<K extends ClusterKind> = Extract<
	KustoClusterConnection,
	{ kind: K }
>;

const DEFAULT_KUSTO_CLUSTERS: KustoClusterConnection[] = [
	{
		id: '5dd7fadc-c5b0-421f-8735-97000e9332ec',
		name: 'Mock cluster',
		description: 'In-memory schema catalog for demo',
		url: MOCK_KUSTO_CLUSTER_URL,
		kind: 'mock'
	},
	{
		id: '23ed073f-f4fd-4b83-a4d1-893d8f36ae29',
		name: 'Emulated cluster',
		description: 'KQL translated and executed in this browser tab',
		url: EMULATED_KUSTO_CLUSTER_URL,
		kind: 'emulated',
		emulatedStorage: { mode: 'memory' }
	},
	{
		id: '36a61d62-3326-45ef-8f99-7c86affd1cb1',
		name: 'Local Kusto',
		description: 'Kustainer running on localhost',
		url: DEFAULT_KUSTO_CLUSTER_URL,
		kind: 'remote',
		ingestion: {
			mode: 'kustainer',
			containerRoot: '/kustodata/raw',
			maxInlineFileBytes: 10 * 1024 * 1024,
			maxInlineCommandBytes: 512 * 1024
		}
	}
];

/** Returns a copy of Kite's built-in cluster catalog. */
export function getKustoClusters(): KustoClusterConnection[] {
	return DEFAULT_KUSTO_CLUSTERS.map((cluster) =>
		cluster.kind === 'remote' && cluster.ingestion
			? { ...cluster, ingestion: { ...cluster.ingestion } }
			: { ...cluster }
	);
}

/** Returns the default browser-visible Kusto cluster URL. */
export function getKustoClusterUrl() {
	return getKustoClusters()[0].url;
}
