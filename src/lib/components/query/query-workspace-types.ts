export type LanguageServiceStatus = 'idle' | 'loading' | 'ready';

export type ConnectionStatistics = {
	databaseCount: number;
	tableCount: number;
	functionCount: number;
};
