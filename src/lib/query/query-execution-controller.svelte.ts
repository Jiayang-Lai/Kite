import { createCancellableOperation } from '$lib/query/cancellable-operation.svelte';
import type { QueryTab } from '$lib/cluster/cluster-session.svelte';
import type { ConnectionRuntime } from '$lib/cluster/cluster-runtime';
import type { RecentQueryStore } from '$lib/query/recent-query-store.svelte';
import { QueryRequestError } from '$lib/types/query-result';

type QueryExecutionControllerOptions = {
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

/**
 * Runs and cancels each tab's query, writing its result or error back to that tab. The tabs hold
 * the query, result and running state; this controller adds only whether the results pane is
 * collapsed.
 */
export function createQueryExecutionController(options: QueryExecutionControllerOptions) {
	const state = $state({ resultsCollapsed: false });
	const operations = new Map<string, ReturnType<typeof createCancellableOperation>>();

	function operationFor(tabId: string) {
		let operation = operations.get(tabId);
		if (!operation) {
			operation = createCancellableOperation();
			operations.set(tabId, operation);
		}
		return operation;
	}

	function updateQuery(value: string) {
		const tab = options.getActiveTab();
		if (tab) options.updateTab(tab.id, { query: value });
	}

	async function run() {
		const tab = options.getActiveTab();
		const query = tab?.query.trim();
		const database = options.getSelectedDatabase();
		const runtime = options.getRuntime();
		if (!tab || !query || !database || tab.isRunning || !runtime || !options.canExecute()) return;

		state.resultsCollapsed = false;
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
				onSuccess: (result) => options.updateTab(tab.id, { result }),
				onError: (error) => {
					const message = formatFailure(errorMessage(error), options.getDiagnostics());
					const update: Partial<Omit<QueryTab, 'id'>> = { result: undefined, error: message };
					if (error instanceof QueryRequestError) {
						update.errorRequestId = error.requestId;
						update.errorRaw = error.response;
					}
					options.updateTab(tab.id, update);
				}
			}
		);

		options.updateTab(tab.id, { isRunning: false });
		if (operations.get(tab.id) === operation) operations.delete(tab.id);
	}

	return {
		state,
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
		},
		dispose() {
			for (const operation of operations.values()) operation.dispose();
			operations.clear();
		}
	};
}
