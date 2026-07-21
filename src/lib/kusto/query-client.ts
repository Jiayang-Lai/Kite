import type { QueryExecution, QueryResult } from '$lib/types/query-result';
import { Client as KustoClient, ClientRequestProperties } from 'azure-kusto-data';

/** Browser-visible endpoint for Kite's default Kusto connection. */
export const DEFAULT_KUSTO_CLUSTER_URL = 'http://localhost:8080';
/** Stable synthetic endpoint used to identify Kite's in-memory schema catalog. */
export const MOCK_KUSTO_CLUSTER_URL = 'mock://kite';

export type KustoClusterConnection = {
	/** Stable identifier used to select this connection independently of its endpoint. */
	id: string;
	/** Human-readable label shown in the cluster selector. */
	name: string;
	/** Optional supporting detail shown beneath the connection name in the selector. */
	description?: string;
	/** Browser-accessible Kusto cluster endpoint. */
	url: string;
	/** Whether the connection executes remotely or only supplies local schema metadata. */
	kind: 'remote' | 'mock';
};

const SERVER_TIMEOUT_MS = 60_000;
const CLIENT_TIMEOUT_MS = 90_000;
const MANAGEMENT_SERVER_TIMEOUT_MS = 10 * 60_000;
const MANAGEMENT_CLIENT_TIMEOUT_MS = MANAGEMENT_SERVER_TIMEOUT_MS + 30_000;
const MAX_SERVER_ROWS = 5_000;
const MAX_RENDERED_ROWS = 1_000;

/** Connections shown in the Explorer without requiring deployment configuration. */
const DEFAULT_KUSTO_CLUSTERS: KustoClusterConnection[] = [
	{
		id: '5dd7fadc-c5b0-421f-8735-97000e9332ec',
		name: 'Mock cluster',
		url: MOCK_KUSTO_CLUSTER_URL,
		kind: 'mock'
	},
	{
		id: '36a61d62-3326-45ef-8f99-7c86affd1cb1',
		name: 'Local Kusto',
		url: DEFAULT_KUSTO_CLUSTER_URL,
		kind: 'remote'
	},
	{
		id: '43bd513e-02dd-463e-864b-522a412983b6',
		name: 'Local Kusto development cluster connection with an intentionally very long display name',
		description:
			'Uses the same local endpoint and deliberately long supporting text to verify selector labels truncate cleanly without affecting adjacent controls.',
		url: DEFAULT_KUSTO_CLUSTER_URL,
		kind: 'remote'
	}
];

/** Returns a copy of Kite's built-in cluster catalog. */
export function getKustoClusters(): KustoClusterConnection[] {
	return DEFAULT_KUSTO_CLUSTERS.map((cluster) => ({ ...cluster }));
}

/** Returns the default browser-visible Kusto cluster URL. */
export function getKustoClusterUrl() {
	return getKustoClusters()[0].url;
}

/** Converts values produced by the SDK into stable values suitable for UI rendering. */
function normalizeCell(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'bigint') return value.toString();
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

type ErrorResponse = {
	status?: number;
	statusText?: string;
	data?: unknown;
	headers?: Record<string, unknown> & { get?: (name: string) => unknown };
};

type KustoErrorContext = {
	clientRequestId?: string;
	activityId?: string;
};

type KustoServiceError = {
	code?: string;
	message?: string;
	'@message'?: string;
	'@database'?: string;
	'@line'?: string | number;
	'@pos'?: string | number;
	'@errorCode'?: string;
	'@errorMessage'?: string;
	'@context'?: KustoErrorContext;
	innererror?: KustoServiceError;
};

function parseResponseData(data: unknown): unknown {
	if (typeof data !== 'string') return data;

	const text = data.trim();
	if (!text.startsWith('{')) return text;

	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function formatStructuredKustoError(error: KustoServiceError) {
	const detail = error.innererror ?? error;
	const context = detail['@context'] ?? error['@context'];
	const code = detail['@errorCode'] ?? detail.code ?? error.code;
	const shortMessage = detail['@errorMessage'] ?? detail.message ?? error.message;
	const technicalMessage = detail['@message'];
	const summary = [code, shortMessage].filter(Boolean).join(': ');
	const location =
		detail['@line'] != null
			? `Line ${detail['@line']}${detail['@pos'] != null ? `, column ${detail['@pos']}` : ''}`
			: '';
	const database = error['@database'] ? `Database: ${error['@database']}` : '';
	const clientRequestId = context?.clientRequestId
		? `Client request ID: ${context.clientRequestId}`
		: '';
	const activityId = context?.activityId ? `Activity ID: ${context.activityId}` : '';

	return [
		summary,
		technicalMessage && technicalMessage !== summary ? technicalMessage : '',
		location,
		database,
		clientRequestId,
		activityId
	]
		.filter(Boolean)
		.join('\n');
}

function formatResponseData(data: unknown) {
	const parsedData = parseResponseData(data);
	if (typeof parsedData === 'string') return parsedData;
	if (!parsedData || typeof parsedData !== 'object') return '';

	const payload = parsedData as {
		message?: string;
		error?: KustoServiceError | string;
	};
	if (typeof payload.error === 'string') return payload.error;
	if (payload.error) return formatStructuredKustoError(payload.error);

	if (payload.message) return payload.message;

	try {
		return JSON.stringify(parsedData, null, 2);
	} catch {
		return '';
	}
}

function getResponseHeader(headers: ErrorResponse['headers'], name: string) {
	return headers?.get?.(name) ?? headers?.[name] ?? headers?.[name.toLowerCase()];
}

/** Produces a detailed message from SDK, Axios, and ordinary JavaScript errors. */
export function getKustoErrorMessage(error: unknown) {
	if (!(error instanceof Error)) return String(error);

	const response = (error as Error & { response?: ErrorResponse }).response;
	if (!response) return error.message;

	const responseMessage = formatResponseData(response.data);
	const status = response.status
		? `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
		: '';
	const activityId = getResponseHeader(response.headers, 'x-ms-activity-id');
	const activityDetail =
		activityId && !responseMessage.includes(String(activityId)) ? `Activity ID: ${activityId}` : '';

	return [status, responseMessage || error.message, activityDetail].filter(Boolean).join('\n\n');
}

/** Returns whether text can be sent to Kusto's management endpoint. */
export function isManagementCommand(command: string) {
	return command.trimStart().startsWith('.');
}

/**
 * Identifies the management commands that only inspect cluster state. Commands
 * outside this small, intentionally conservative set require UI confirmation.
 */
export function isReadOnlyManagementCommand(command: string) {
	return /^\s*\.(?:show|explain)\b/i.test(command);
}

type KustoResultTable = {
	columns: Array<{ name?: string; type?: string }>;
	rows: () => Iterable<{ getValueAt: (index: number) => unknown }>;
	_rows: unknown[];
};

type KustoResponse = {
	primaryResults: KustoResultTable[];
	getWarnings: () => string[];
};

function normalizeResponse(
	response: KustoResponse,
	startedAt: number,
	clientRequestId: string
): QueryResult {
	const primaryResult = response.primaryResults[0];
	if (!primaryResult) {
		return {
			columns: [],
			rows: [],
			totalRowCount: 0,
			renderedRowCount: 0,
			warnings: response.getWarnings(),
			elapsedMs: performance.now() - startedAt,
			clientRequestId
		};
	}

	const columns = primaryResult.columns.map((column, index) => ({
		name: column.name ?? `Column ${index + 1}`,
		type: column.type ?? 'unknown'
	}));
	const rows: unknown[][] = [];
	for (const row of primaryResult.rows()) {
		if (rows.length >= MAX_RENDERED_ROWS) break;
		rows.push(columns.map((_, index) => normalizeCell(row.getValueAt(index))));
	}

	return {
		columns,
		rows,
		totalRowCount: primaryResult._rows.length,
		renderedRowCount: rows.length,
		warnings: response.getWarnings(),
		elapsedMs: performance.now() - startedAt,
		clientRequestId
	};
}

/**
 * Starts a read-only Kusto query against `/v2/rest/query`.
 *
 * A fresh SDK client is used for each execution because the SDK cancellation API
 * closes a client-wide token source. This keeps cancellation scoped to one Run.
 * Calling `executeQuery` explicitly also prevents editor text beginning with a
 * dot from being routed to the management endpoint.
 */
export function startKustoQuery(
	database: string,
	query: string,
	clusterUrl = getKustoClusterUrl()
): QueryExecution {
	const client = new KustoClient(clusterUrl);
	const clientRequestId = `Kite.Query;${crypto.randomUUID()}`;
	const properties = new ClientRequestProperties();
	properties.clientRequestId = clientRequestId;
	properties.application = 'Kite';
	properties.setTimeout(SERVER_TIMEOUT_MS);
	properties.setClientTimeout(CLIENT_TIMEOUT_MS);
	properties.setOption('truncationmaxrecords', MAX_SERVER_ROWS);

	let cancelled = false;
	const startedAt = performance.now();
	const promise = client
		.executeQuery(database, query, properties)
		.then((response) =>
			normalizeResponse(response as unknown as KustoResponse, startedAt, clientRequestId)
		)
		.catch((error: unknown) => {
			if (cancelled) throw new Error('Query cancelled.');
			throw error;
		})
		.finally(() => client.close());

	return {
		promise,
		cancel() {
			cancelled = true;
			client.close();
		}
	};
}

/**
 * Starts a Kusto management command against `/v1/rest/mgmt`. This is kept
 * separate from `startKustoQuery` so ordinary KQL can never be accidentally
 * routed to the administrative endpoint.
 */
export function startKustoManagementCommand(
	database: string,
	command: string,
	clusterUrl = getKustoClusterUrl()
): QueryExecution {
	if (!isManagementCommand(command)) {
		throw new Error('Management commands must start with a period (for example, .show tables).');
	}

	const client = new KustoClient(clusterUrl);
	const clientRequestId = `Kite.Admin;${crypto.randomUUID()}`;
	const properties = new ClientRequestProperties();
	properties.clientRequestId = clientRequestId;
	properties.application = 'Kite';
	properties.setTimeout(MANAGEMENT_SERVER_TIMEOUT_MS);
	properties.setClientTimeout(MANAGEMENT_CLIENT_TIMEOUT_MS);
	properties.setOption('truncationmaxrecords', MAX_SERVER_ROWS);

	let cancelled = false;
	const startedAt = performance.now();
	const promise = client
		.executeMgmt(database, command, properties)
		.then((response) =>
			normalizeResponse(response as unknown as KustoResponse, startedAt, clientRequestId)
		)
		.catch((error: unknown) => {
			if (cancelled) throw new Error('Command cancelled.');
			throw error;
		})
		.finally(() => client.close());

	return {
		promise,
		cancel() {
			cancelled = true;
			client.close();
		}
	};
}
