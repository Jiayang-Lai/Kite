import type { LogAnalyticsQueryStatistics } from './log-analytics';

/** Provider-neutral query failure with optional request correlation and structured details. */
export class QueryRequestError extends Error {
	constructor(
		message: string,
		readonly requestId?: string,
		readonly response?: unknown
	) {
		super(message);
		this.name = 'QueryRequestError';
	}
}

/** Raised when the user or Kite cancels an in-flight operation; never a provider failure. */
export class OperationCancelledError extends Error {
	constructor(message = 'Operation cancelled.') {
		super(message);
		this.name = 'OperationCancelledError';
	}
}

/** Recognizes Kite cancellations and aborted fetch/signal operations. */
export function isOperationCancelled(error: unknown) {
	return (
		error instanceof OperationCancelledError ||
		(error instanceof DOMException && error.name === 'AbortError')
	);
}

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
