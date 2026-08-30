import { describe, expect, it, vi } from 'vitest';

import { createQueryExecutionController } from './query-execution-controller.svelte';
import type { QueryTab } from '$lib/cluster/cluster-session.svelte';
import { LogAnalyticsQueryRequestError } from '$lib/log-analytics/client';
import type { QueryResult } from '$lib/types/query-result';

const result = (clientRequestId: string): QueryResult => ({
	columns: [],
	rows: [],
	totalRowCount: 0,
	renderedRowCount: 0,
	warnings: [],
	elapsedMs: 0,
	clientRequestId
});

describe('createQueryExecutionController', () => {
	it('keeps concurrent executions owned by their respective tabs', async () => {
		let resolveFirst!: (value: QueryResult) => void;
		let resolveSecond!: (value: QueryResult) => void;
		const first = new Promise<QueryResult>((resolve) => (resolveFirst = resolve));
		const second = new Promise<QueryResult>((resolve) => (resolveSecond = resolve));
		const tabs: QueryTab[] = [
			{ id: 'first', database: 'db', query: 'first', isRunning: false },
			{ id: 'second', database: 'db', query: 'second', isRunning: false }
		];
		let activeTab = tabs[0];
		const updateTab = vi.fn((id: string, update: Partial<Omit<QueryTab, 'id'>>) => {
			Object.assign(
				tabs.find((tab) => tab.id === id)!,
				update
			);
		});
		const controller = createQueryExecutionController({
			recentQueries: { record: vi.fn() } as never,
			getActiveTab: () => activeTab,
			getActiveClusterId: () => 'cluster',
			getSelectedDatabase: () => 'db',
			getRuntime: () =>
				({
					startQuery: (_database: string, query: string) => ({
						promise: query === 'first' ? first : second,
						cancel: vi.fn()
					})
				}) as never,
			canExecute: () => true,
			getDiagnostics: () => [],
			updateTab
		});

		controller.loadTab(tabs[0]);
		const firstRun = controller.run();
		activeTab = tabs[1];
		controller.loadTab(tabs[1]);
		const secondRun = controller.run();
		resolveFirst(result('first'));
		resolveSecond(result('second'));
		await Promise.all([firstRun, secondRun]);

		expect(tabs).toMatchObject([
			{ id: 'first', isRunning: false, result: { clientRequestId: 'first' } },
			{ id: 'second', isRunning: false, result: { clientRequestId: 'second' } }
		]);
	});

	it('records one recent query and preserves Log Analytics diagnostics on failure', async () => {
		const rawError = { error: { code: 'BadArgument' } };
		const failure = new LogAnalyticsQueryRequestError(
			'HTTP 400: Invalid query',
			'request-id',
			rawError
		);
		const tab: QueryTab = {
			id: 'active',
			database: 'Logs',
			query: 'AppEvents | broken',
			isRunning: false
		};
		const recentQueries = { record: vi.fn() };
		const updateTab = vi.fn((id: string, update: Partial<Omit<QueryTab, 'id'>>) => {
			if (id === tab.id) Object.assign(tab, update);
		});
		const controller = createQueryExecutionController({
			recentQueries: recentQueries as never,
			getActiveTab: () => tab,
			getActiveClusterId: () => 'logs-cluster',
			getSelectedDatabase: () => 'Logs',
			getRuntime: () =>
				({
					startQuery: () => ({ promise: Promise.reject(failure), cancel: vi.fn() })
				}) as never,
			canExecute: () => true,
			getDiagnostics: () => [
				{
					severity: 'error',
					line: 1,
					column: 13,
					code: 'KS001',
					message: 'Expected an operator'
				}
			],
			updateTab
		});
		controller.loadTab(tab);

		await controller.run();

		expect(recentQueries.record).toHaveBeenCalledOnce();
		expect(recentQueries.record).toHaveBeenCalledWith({
			clusterId: 'logs-cluster',
			database: 'Logs',
			name: 'AppEvents | broken',
			query: 'AppEvents | broken'
		});
		expect(tab.error).toContain('HTTP 400: Invalid query');
		expect(tab.error).toContain('Line 1, column 13 [KS001]: Expected an operator');
		expect(tab).toMatchObject({
			isRunning: false,
			errorRequestId: 'request-id',
			errorRaw: rawError
		});
		expect(controller.state).toMatchObject({
			isRunning: false,
			errorRequestId: 'request-id',
			errorRaw: rawError
		});
	});

	it('cancels and invalidates active work during reset', async () => {
		let resolveQuery!: (value: QueryResult) => void;
		const queryPromise = new Promise<QueryResult>((resolve) => (resolveQuery = resolve));
		const cancel = vi.fn();
		const tab: QueryTab = {
			id: 'active',
			database: 'Samples',
			query: 'StormEvents | take 1',
			isRunning: false
		};
		const updateTab = vi.fn((id: string, update: Partial<Omit<QueryTab, 'id'>>) => {
			if (id === tab.id) Object.assign(tab, update);
		});
		const controller = createQueryExecutionController({
			recentQueries: { record: vi.fn() } as never,
			getActiveTab: () => tab,
			getActiveClusterId: () => 'cluster',
			getSelectedDatabase: () => 'Samples',
			getRuntime: () => ({ startQuery: () => ({ promise: queryPromise, cancel }) }) as never,
			canExecute: () => true,
			getDiagnostics: () => [],
			updateTab
		});
		controller.loadTab(tab);

		const run = controller.run();
		controller.cancel();
		expect(cancel).toHaveBeenCalledOnce();
		controller.reset();
		resolveQuery(result('late-result'));
		await run;

		expect(tab.isRunning).toBe(false);
		expect(tab.result).toBeUndefined();
		expect(controller.state.isRunning).toBe(false);
	});

	it.each([
		{ label: 'blank query', query: '   ', database: 'Samples', canExecute: true, hasRuntime: true },
		{
			label: 'missing database',
			query: 'print 1',
			database: '',
			canExecute: true,
			hasRuntime: true
		},
		{
			label: 'unsupported connection',
			query: 'print 1',
			database: 'Samples',
			canExecute: false,
			hasRuntime: true
		},
		{
			label: 'missing runtime',
			query: 'print 1',
			database: 'Samples',
			canExecute: true,
			hasRuntime: false
		}
	])('does not start a query for $label', async ({ query, database, canExecute, hasRuntime }) => {
		const startQuery = vi.fn();
		const tab: QueryTab = { id: 'active', database, query, isRunning: false };
		const recentQueries = { record: vi.fn() };
		const controller = createQueryExecutionController({
			recentQueries: recentQueries as never,
			getActiveTab: () => tab,
			getActiveClusterId: () => 'cluster',
			getSelectedDatabase: () => database,
			getRuntime: () => (hasRuntime ? ({ startQuery } as never) : undefined),
			canExecute: () => canExecute,
			getDiagnostics: () => [],
			updateTab: vi.fn()
		});
		controller.loadTab(tab);

		await controller.run();

		expect(startQuery).not.toHaveBeenCalled();
		expect(recentQueries.record).not.toHaveBeenCalled();
	});
});
