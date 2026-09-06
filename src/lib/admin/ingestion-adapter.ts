import {
	startEmulatedIngestion,
	type EmulatedIngestionRequest
} from '$lib/emulation/data-ingestion';
import { getKustoErrorMessage, startKustoManagementCommand } from '$lib/kusto/query-client';
import type { QueryExecution } from '$lib/types/query-result';

export type IngestionRequest =
	| { kind: 'emulated'; request: EmulatedIngestionRequest }
	| { kind: 'kustainer'; database: string; command: string; clusterUrl: string };

/** Starts ingestion through the adapter selected by the active connection. */
export function startIngestion(request: IngestionRequest): QueryExecution {
	return request.kind === 'emulated'
		? startEmulatedIngestion(request.request)
		: startKustoManagementCommand(request.database, request.command, request.clusterUrl);
}

export function formatIngestionError(error: unknown, kind: IngestionRequest['kind']) {
	const message = getKustoErrorMessage(error);
	if (message !== 'Command cancelled.') return message;
	return kind === 'emulated'
		? 'Ingestion cancelled. DuckDB rolled back the active append.'
		: 'Stopped waiting for ingestion. The Kusto operation may still complete.';
}
