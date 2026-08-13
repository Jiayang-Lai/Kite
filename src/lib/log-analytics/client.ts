import { acquireLogAnalyticsToken } from '$lib/log-analytics/auth';
import type { LogAnalyticsConnectionConfiguration } from '$lib/kusto/query-client';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
import type { LogAnalyticsQueryError, LogAnalyticsQueryStatistics } from '$lib/types/log-analytics';
import type { QueryExecution, QueryResult } from '$lib/types/query-result';

const ENDPOINT = 'https://api.loganalytics.azure.com/v1/workspaces';
const METADATA_ENDPOINT = 'https://api.loganalytics.io/v1';
// Keep the browser deadline just beyond Azure's requested 10-minute server timeout.
const CLIENT_TIMEOUT_MS = 630_000;
const MAX_RENDERED_ROWS = 1_000;

/** Portal-equivalent query options for execution diagnostics and visualizations. */
export const LOG_ANALYTICS_QUERY_PREFER =
	'wait=600, ai.include-statistics=true, ai.include-render=true, include-datasources=true';

type LogsColumn = { name: string; type?: string; description?: string };
type LogsTable = { name?: string; columns?: LogsColumn[]; rows?: unknown[][] };
type LogsResponse = {
	tables?: LogsTable[];
	statistics?: LogAnalyticsQueryStatistics;
	render?: unknown;
	dataSources?: unknown;
	error?: LogAnalyticsQueryError;
};
type MetadataTable = { name?: string; description?: string; columns?: LogsColumn[] };
type MetadataFunction = { name?: string; body?: string; description?: string };
type MetadataResponse = { tables?: MetadataTable[]; functions?: MetadataFunction[] };

/** Preserves Azure's request correlation and structured error response for the results UI. */
export class LogAnalyticsQueryRequestError extends Error {
	constructor(
		message: string,
		readonly requestId?: string,
		readonly response?: unknown
	) {
		super(message);
		this.name = 'LogAnalyticsQueryRequestError';
	}
}

function queryEndpoint(config: LogAnalyticsConnectionConfiguration) {
	return `${ENDPOINT}/${encodeURIComponent(config.workspaceId)}/query`;
}

function metadataEndpoint(config: LogAnalyticsConnectionConfiguration, select: string) {
	if (!config.workspaceResourceId) {
		throw new Error('Edit this Log Analytics connection and enter its workspace resource ID.');
	}
	return `${METADATA_ENDPOINT}${config.workspaceResourceId}/metadata?select=${encodeURIComponent(select)}`;
}

async function request<T>(
	config: LogAnalyticsConnectionConfiguration,
	operation: 'query',
	body: Record<string, unknown>,
	signal: AbortSignal
): Promise<{ payload: T; requestId?: string }> {
	const token = await acquireLogAnalyticsToken(config);
	const response = await fetch(queryEndpoint(config), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			Prefer: LOG_ANALYTICS_QUERY_PREFER
		},
		body: JSON.stringify(body),
		signal
	});
	const payload: unknown = await response.json().catch(() => undefined);
	if (!response.ok) {
		const error = payload as LogsResponse | undefined;
		const detail = error?.error?.message ?? error?.error?.code;
		throw new LogAnalyticsQueryRequestError(
			`HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
			response.headers.get('x-ms-request-id') ?? undefined,
			payload
		);
	}
	return { payload: payload as T, requestId: response.headers.get('x-ms-request-id') ?? undefined };
}

async function requestMetadata(
	config: LogAnalyticsConnectionConfiguration,
	select: string,
	signal: AbortSignal
): Promise<MetadataResponse> {
	const token = await acquireLogAnalyticsToken(config);
	const isPortalFunctionMetadata = select === 'resourceTypes,functions';
	const response = await fetch(metadataEndpoint(config, select), {
		method: isPortalFunctionMetadata ? 'POST' : 'GET',
		headers: {
			Authorization: `Bearer ${token}`,
			...(isPortalFunctionMetadata
				? {
						Accept: '*/*',
						'Content-Type': 'text/plain;charset=UTF-8',
						Prefer: 'metadata-format-v4,exclude-customlogs,exclude-customfields,wait=180'
					}
				: {})
		},
		...(isPortalFunctionMetadata ? { body: '' } : {}),
		signal
	});
	const payload: unknown = await response.json().catch(() => undefined);
	if (!response.ok) {
		const error = payload as LogsResponse | undefined;
		const detail = error?.error?.message ?? error?.error?.code;
		throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
	}
	return payload as MetadataResponse;
}

function normalizeCell(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalizeCell);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, item]) => [
				key,
				normalizeCell(item)
			])
		);
	}
	return value;
}

/** Loads the Log Analytics metadata endpoint into the schema consumed by Explorer and Monaco. */
export function parseLogAnalyticsMetadata(
	tableResponse: MetadataResponse,
	connectionName: string,
	workspaceId: string,
	functionResponse: MetadataResponse = {}
): KustoDatabaseSchema {
	const databaseName = connectionName.trim() || workspaceId;
	return {
		[databaseName]: {
			name: databaseName,
			tables: (tableResponse.tables ?? [])
				.filter((table): table is MetadataTable & { name: string } => Boolean(table.name))
				.map((table) => ({
					name: table.name,
					docstring: table.description,
					columns: (table.columns ?? []).map((column) => ({
						name: column.name,
						type: column.type ?? 'dynamic',
						docstring: column.description
					}))
				})),
			functions: (functionResponse.functions ?? [])
				.filter((fn): fn is MetadataFunction & { name: string; body: string } =>
					Boolean(fn.name && fn.body)
				)
				.map((fn) => ({
					name: fn.name,
					body: fn.body,
					docstring: fn.description,
					inputParameters: []
				}))
		}
	};
}

export async function loadLogAnalyticsSchema(
	config: LogAnalyticsConnectionConfiguration,
	connectionName: string
): Promise<KustoDatabaseSchema> {
	const controller = new AbortController();
	const [tableResponse, functionResponse] = await Promise.all([
		requestMetadata(config, 'categories,solutions,tables,workspaces', controller.signal),
		requestMetadata(config, 'resourceTypes,functions', controller.signal)
	]);
	return parseLogAnalyticsMetadata(
		tableResponse,
		connectionName,
		config.workspaceId,
		functionResponse
	);
}

/** Starts one cancellable Logs Query API call against a configured workspace. */
export function startLogAnalyticsQuery(
	config: LogAnalyticsConnectionConfiguration,
	query: string
): QueryExecution {
	const controller = new AbortController();
	const startedAt = performance.now();
	const clientRequestId = `Kite.LogAnalytics;${crypto.randomUUID()}`;
	const timeout = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
	let cancelled = false;
	const body: Record<string, unknown> = { query };
	if (config.defaultTimespan) body.timespan = config.defaultTimespan;
	const promise = request<LogsResponse>(config, 'query', body, controller.signal)
		.then(({ payload: response, requestId }) => {
			const table = response.tables?.[0];
			const columns = (table?.columns ?? []).map((column, index) => ({
				name: column.name || `Column ${index + 1}`,
				type: column.type ?? 'unknown'
			}));
			const rows = (table?.rows ?? [])
				.slice(0, MAX_RENDERED_ROWS)
				.map((row) => row.map(normalizeCell));
			return {
				columns,
				rows,
				totalRowCount: table?.rows?.length ?? 0,
				renderedRowCount: rows.length,
				warnings: [],
				elapsedMs: performance.now() - startedAt,
				clientRequestId: requestId ?? clientRequestId,
				statistics: response.statistics,
				render: response.render,
				dataSources: response.dataSources
			};
		})
		.catch((error: unknown) => {
			if (cancelled) throw new Error('Query cancelled.');
			if (controller.signal.aborted) throw new Error('Query timed out.');
			throw error;
		})
		.finally(() => window.clearTimeout(timeout));
	return {
		promise,
		cancel: () => {
			cancelled = true;
			controller.abort();
		}
	};
}
