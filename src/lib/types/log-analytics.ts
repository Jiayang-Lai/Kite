/** Duration string returned by Azure Monitor, such as `00:00:00.1234567`. */
export type LogAnalyticsDuration = string;

export type LogAnalyticsCacheShardStatistics = {
	hitbytes?: number;
	missbytes?: number;
	retrievebytes?: number;
};

export type LogAnalyticsQueryResourceUsage = {
	cache?: {
		shards?: {
			hot?: LogAnalyticsCacheShardStatistics;
			cold?: LogAnalyticsCacheShardStatistics;
			bypassbytes?: number;
		};
	};
	cpu?: {
		user?: LogAnalyticsDuration;
		kernel?: LogAnalyticsDuration;
		totalCpu?: LogAnalyticsDuration;
		breakdown?: {
			queryExecution?: LogAnalyticsDuration;
			queryPlanning?: LogAnalyticsDuration;
		};
	};
	memory?: { peakPerNode?: number };
	network?: {
		interClusterTotalBytes?: number;
		crossClusterTotalBytes?: number;
	};
};

export type LogAnalyticsInputDatasetStatistics = {
	extents?: {
		total?: number;
		scanned?: number;
		scannedMinDatetime?: string;
		scannedMaxDatetime?: string;
	};
	rows?: { total?: number; scanned?: number };
	rowstores?: { scannedRows?: number; scannedValuesSize?: number };
	shards?: { queriesGeneric?: number; queriesSpecialized?: number };
};

export type LogAnalyticsDatasetStatistics = {
	tableRowCount?: number;
	tableSize?: number;
};

/** A structured error returned by the Azure Monitor Logs Query API. */
export type LogAnalyticsQueryError = {
	message?: string;
	code?: string;
	correlationId?: string;
	line?: number;
	pos?: number;
	token?: string;
	innererror?: LogAnalyticsQueryError;
};

/** Error response envelope returned when a Logs Query API request is rejected. */
export type LogAnalyticsQueryErrorResponse = {
	error?: LogAnalyticsQueryError;
};

/**
 * Diagnostics returned in the Logs Query API `statistics` property when the
 * request includes `Prefer: include-statistics=true`.
 *
 * Azure can omit fields or introduce additional data depending on the query,
 * so every documented/sample field is optional.
 */
export type LogAnalyticsQueryStatistics = {
	query?: {
		queryHash?: string;
		executionTime?: number;
		resourceUsage?: LogAnalyticsQueryResourceUsage;
		inputDatasetStatistics?: LogAnalyticsInputDatasetStatistics;
		datasetStatistics?: LogAnalyticsDatasetStatistics[];
		crossClusterResourceUsage?: Record<string, unknown>;
	};
	enhancedStats?: {
		executionTimeBreakdown?: {
			queue?: number;
			engine?: number;
			service?: number;
		};
		uncompressedResponseSize?: number;
	};
};
