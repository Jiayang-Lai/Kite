import type { QueryResult } from '$lib/types/query-result';

export type LanguageServiceStatus = 'idle' | 'loading' | 'ready';

export type QueryWorkspaceExecutionState = {
	queryText: string;
	result?: QueryResult;
	error: string;
	errorRequestId?: string;
	errorRaw?: unknown;
	isRunning: boolean;
	resultsCollapsed: boolean;
};

export type ConnectionStatistics = {
	databaseCount: number;
	tableCount: number;
	functionCount: number;
};
