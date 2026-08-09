import type { LogAnalyticsQueryStatistics } from './log-analytics';

/** Column metadata returned by a Kusto primary result table. */
export type QueryResultColumn = {
	name: string;
	type: string;
};

/** Plain, renderer-friendly representation of a Kusto primary result. */
export type QueryResult = {
	columns: QueryResultColumn[];
	rows: unknown[][];
	totalRowCount: number;
	renderedRowCount: number;
	warnings: string[];
	elapsedMs: number;
	clientRequestId: string;
	/** Optional diagnostics returned by the Azure Monitor Logs Query API. */
	statistics?: LogAnalyticsQueryStatistics;
	/** Optional visualization metadata returned by the Azure Monitor Logs Query API. */
	render?: unknown;
	/** Optional workspace, cluster, and table metadata returned by the Azure Monitor Logs Query API. */
	dataSources?: unknown;
};

/** Handle for one cancellable SDK operation. */
export type CancellableExecution<T> = {
	promise: Promise<T>;
	cancel: () => void;
};

/** Handle for one in-flight query or management command. */
export type QueryExecution = CancellableExecution<QueryResult>;
