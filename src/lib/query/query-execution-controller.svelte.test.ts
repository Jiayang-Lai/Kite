import { describe, expect, it, vi } from 'vitest';

import { createQueryExecutionController } from './query-execution-controller.svelte';
import type { QueryTab } from '$lib/cluster/cluster-session.svelte';
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
});
