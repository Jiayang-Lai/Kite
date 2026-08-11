import type { QueryResult } from '$lib/types/query-result';

export type QueryDetail = {
	label: string;
	value: string;
};

function formatMilliseconds(value: number) {
	return `${Math.round(value)} ms`;
}

function formatBytes(value: number) {
	return `${(value / 1_000_000).toFixed(1)} MB (${value.toLocaleString()} bytes)`;
}

/** Builds the shared and Azure Monitor-specific values shown in query details. */
export function getQueryDetails(result: QueryResult): QueryDetail[] {
	const details: QueryDetail[] = [
		{ label: 'Execution time', value: formatMilliseconds(result.elapsedMs) },
		{ label: 'Rows returned', value: result.totalRowCount.toLocaleString() },
		{ label: 'Rows rendered', value: result.renderedRowCount.toLocaleString() },
		{ label: 'Request ID', value: result.clientRequestId }
	];
	const statistics = result.statistics;
	if (!statistics) return details;

	const query = statistics.query;
	const usage = query?.resourceUsage;
	const timing = statistics.enhancedStats?.executionTimeBreakdown;
	details.splice(
		1,
		0,
		{
			label: 'Engine execution time',
			value: timing?.engine == null ? 'N/A' : formatMilliseconds(timing.engine)
		},
		{
			label: 'Service execution time',
			value: timing?.service == null ? 'N/A' : formatMilliseconds(timing.service)
		},
		{
			label: 'Service queue time',
			value: timing?.queue == null ? 'N/A' : formatMilliseconds(timing.queue)
		},
		{ label: 'Total CPU', value: usage?.cpu?.totalCpu ?? 'N/A' },
		{
			label: 'Memory peak',
			value: usage?.memory?.peakPerNode == null ? 'N/A' : formatBytes(usage.memory.peakPerNode)
		},
		{
			label: 'Response size (uncompressed)',
			value:
				statistics.enhancedStats?.uncompressedResponseSize == null
					? 'N/A'
					: formatBytes(statistics.enhancedStats.uncompressedResponseSize)
		},
		{
			label: 'Rows scanned',
			value: query?.inputDatasetStatistics?.rows?.scanned?.toLocaleString() ?? 'N/A'
		},
		{
			label: 'Extents scanned',
			value: query?.inputDatasetStatistics?.extents?.scanned?.toLocaleString() ?? 'N/A'
		},
		{ label: 'Query hash', value: query?.queryHash ?? 'N/A' }
	);

	return details;
}
