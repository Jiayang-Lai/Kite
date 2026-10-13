import {
	OperationCancelledError,
	QueryRequestError,
	type CancellableExecution,
	type QueryExecution,
	type QueryResult
} from '$lib/types/query-result';
import { normalizeResultValue } from '$lib/query/result-value';
import { Client as KustoClient, ClientRequestProperties } from 'azure-kusto-data';
import { getErrorMessage } from '$lib/query/error-message';

const SERVER_TIMEOUT_MS = 60_000;
const CLIENT_TIMEOUT_MS = 90_000;
const MANAGEMENT_SERVER_TIMEOUT_MS = 10 * 60_000;
const MANAGEMENT_CLIENT_TIMEOUT_MS = MANAGEMENT_SERVER_TIMEOUT_MS + 30_000;
const MAX_SERVER_ROWS = 5_000;
const MAX_RENDERED_ROWS = 1_000;

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
		rows.push(columns.map((_, index) => normalizeResultValue(row.getValueAt(index))));
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
	clusterUrl: string
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
			if (cancelled) throw new OperationCancelledError('Query cancelled.');
			throw new QueryRequestError(getErrorMessage(error), clientRequestId, error);
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
	clusterUrl: string
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
			if (cancelled) throw new OperationCancelledError('Command cancelled.');
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
 * Runs an ordered set of management commands through one cancellable client.
 *
 * This is intended for read-only metadata preflights that must be treated as one
 * UI operation. It stops at the first failed command and returns normalized
 * results in the same order as the supplied command list.
 */
export function startKustoReadOnlyManagementCommandBatch(
	database: string,
	commands: readonly string[],
	clusterUrl: string
): CancellableExecution<QueryResult[]> {
	if (!commands.length) throw new Error('Provide at least one management command.');
	for (const command of commands) {
		if (!isManagementCommand(command)) {
			throw new Error('Management commands must start with a period (for example, .show tables).');
		}
		if (!isReadOnlyManagementCommand(command)) {
			throw new Error('Batched management commands must be read-only.');
		}
	}

	const client = new KustoClient(clusterUrl);
	const requestPrefix = `Kite.Admin.Preflight;${crypto.randomUUID()}`;
	let cancelled = false;

	const promise = (async () => {
		const results: QueryResult[] = [];
		for (const [index, command] of commands.entries()) {
			if (cancelled) throw new OperationCancelledError('Command cancelled.');

			const clientRequestId = `${requestPrefix};${index + 1}`;
			const properties = new ClientRequestProperties();
			properties.clientRequestId = clientRequestId;
			properties.application = 'Kite';
			properties.setTimeout(MANAGEMENT_SERVER_TIMEOUT_MS);
			properties.setClientTimeout(MANAGEMENT_CLIENT_TIMEOUT_MS);
			properties.setOption('truncationmaxrecords', MAX_SERVER_ROWS);
			const startedAt = performance.now();
			const response = await client.executeMgmt(database, command, properties);
			results.push(
				normalizeResponse(response as unknown as KustoResponse, startedAt, clientRequestId)
			);
		}
		return results;
	})()
		.catch((error: unknown) => {
			if (cancelled) throw new OperationCancelledError('Command cancelled.');
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
