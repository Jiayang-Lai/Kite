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
};

/** Handle for one cancellable SDK operation. */
export type CancellableExecution<T> = {
	promise: Promise<T>;
	cancel: () => void;
};

/** Handle for one in-flight query or management command. */
export type QueryExecution = CancellableExecution<QueryResult>;
