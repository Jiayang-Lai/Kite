import { createCancellableOperation } from '$lib/query/cancellable-operation.svelte';
import type { QueryTab } from '$lib/cluster/cluster-session.svelte';
import type { ConnectionRuntime } from '$lib/cluster/cluster-runtime';
import type { RecentQueryStore } from '$lib/query/recent-query-store.svelte';
import { QueryRequestError, type QueryResult } from '$lib/types/query-result';

export type QueryExecutionState = {
	queryText: string;
	result?: QueryResult;
	error: string;
	errorRequestId?: string;
	errorRaw?: unknown;
	isRunning: boolean;
	resultsCollapsed: boolean;
};

type QueryExecutionControllerOptions = {
	state?: QueryExecutionState;
	recentQueries: RecentQueryStore;
	getActiveTab: () => QueryTab | undefined;
	getActiveClusterId: () => string;
	getSelectedDatabase: () => string;
	getRuntime: () => ConnectionRuntime | undefined;
	canExecute: () => boolean;
	getDiagnostics: () => Array<{
		severity: 'error' | 'warning' | 'info';
		line: number;
		column: number;
		code?: string;
		message: string;
	}>;
	updateTab: (tabId: string, update: Partial<Omit<QueryTab, 'id'>>) => void;
};

function recentQueryName(query: string) {
	const firstLine = query.split('\n').find((line) => line.trim());
	return firstLine?.trim().replaceAll(/\s+/g, ' ').slice(0, 48) || 'Query';
}

function formatFailure(
	serverMessage: string,
	diagnostics: ReturnType<QueryExecutionControllerOptions['getDiagnostics']>
) {
	const actionable = diagnostics.filter(
		(diagnostic) => diagnostic.severity === 'error' || diagnostic.severity === 'warning'
	);
	if (!actionable.length) return serverMessage;
	const lines = actionable.map((diagnostic) => {
		const code = diagnostic.code ? ` [${diagnostic.code}]` : '';
		return `Line ${diagnostic.line}, column ${diagnostic.column}${code}: ${diagnostic.message}`;
	});
	return `${serverMessage}\n\nEditor diagnostics:\n${lines.join('\n')}`;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

/** Owns query result state, cancellation, and stale-response suppression for one workspace. */
export function createQueryExecutionController(options: QueryExecutionControllerOptions) {
	let state = $state<QueryExecutionState>({
		queryText: '',
		error: '',
		isRunning: false,
		resultsCollapsed: false
	});
	if (options.state) state = options.state;
	const operations = new Map<string, ReturnType<typeof createCancellableOperation>>();

	function operationFor(tabId: string) {
		let operation = operations.get(tabId);
		if (!operation) {
			operation = createCancellableOperation();
			operations.set(tabId, operation);
		}
		return operation;
	}

	function loadTab(tab: QueryTab) {
		state.queryText = tab.query;
		state.result = tab.result;
		state.error = tab.error ?? '';
		state.errorRequestId = tab.errorRequestId;
		state.errorRaw = tab.errorRaw;
		state.isRunning = tab.isRunning;
	}

	function updateQuery(value: string) {
		state.queryText = value;
		const tab = options.getActiveTab();
		if (tab) options.updateTab(tab.id, { query: value });
	}

	async function run() {
		const tab = options.getActiveTab();
		const query = state.queryText.trim();
		const database = options.getSelectedDatabase();
		const runtime = options.getRuntime();
		if (!tab || !query || !database || tab.isRunning || !runtime || !options.canExecute()) return;

		state.error = '';
		state.errorRequestId = undefined;
		state.errorRaw = undefined;
		state.resultsCollapsed = false;
		state.isRunning = true;
		const operation = operationFor(tab.id);
		options.updateTab(tab.id, {
			isRunning: true,
			result: undefined,
			error: undefined,
			errorRequestId: undefined,
			errorRaw: undefined
		});
		options.recentQueries.record({
			clusterId: options.getActiveClusterId(),
			database,
			name: recentQueryName(query),
			query
		});

		await operation.run(
			(context) => {
				const execution = runtime.startQuery(database, query);
				context.setExecution(execution);
				return execution.promise;
			},
			{
				onSuccess: (result) => {
					options.updateTab(tab.id, { result });
					if (options.getActiveTab()?.id === tab.id) state.result = result;
				},
				onError: (error) => {
					const message = formatFailure(errorMessage(error), options.getDiagnostics());
					const update: Partial<Omit<QueryTab, 'id'>> = { result: undefined, error: message };
					if (error instanceof QueryRequestError) {
						update.errorRequestId = error.requestId;
						update.errorRaw = error.response;
					}
					options.updateTab(tab.id, update);
					if (options.getActiveTab()?.id === tab.id) {
						state.result = undefined;
						state.error = message;
						state.errorRequestId = update.errorRequestId;
						state.errorRaw = update.errorRaw;
					}
				}
			}
		);

		options.updateTab(tab.id, { isRunning: false });
		if (options.getActiveTab()?.id === tab.id) state.isRunning = false;
		if (operations.get(tab.id) === operation) operations.delete(tab.id);
	}

	return {
		get state() {
			return state;
		},
		loadTab,
		updateQuery,
		run,
		cancel() {
			const tab = options.getActiveTab();
			if (tab) operations.get(tab.id)?.cancel();
		},
		cancelTab(tabId: string) {
			operations.get(tabId)?.cancel();
		},
		reset() {
			for (const [tabId, operation] of operations) {
				operation.cancelAndInvalidate();
				options.updateTab(tabId, { isRunning: false });
			}
			operations.clear();
			state.isRunning = false;
		},
		dispose() {
			for (const operation of operations.values()) operation.dispose();
			operations.clear();
		}
	};
}
