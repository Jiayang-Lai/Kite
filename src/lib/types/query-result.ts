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

/** Handle for one in-flight SDK request. Closing it cancels only that request. */
export type QueryExecution = {
	promise: Promise<QueryResult>;
	cancel: () => void;
};
