import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
	clients: [] as Array<{ close: ReturnType<typeof vi.fn> }>,
	properties: [] as Array<{
		clientRequestId: string;
		application: string;
		setTimeout: ReturnType<typeof vi.fn>;
		setClientTimeout: ReturnType<typeof vi.fn>;
		setOption: ReturnType<typeof vi.fn>;
	}>,
	executeQuery: vi.fn(),
	executeMgmt: vi.fn()
}));

vi.mock('azure-kusto-data', () => {
	class ClientRequestProperties {
		clientRequestId = '';
		application = '';
		setTimeout = vi.fn();
		setClientTimeout = vi.fn();
		setOption = vi.fn();

		constructor() {
			sdkMocks.properties.push(this);
		}
	}
	class Client {
		close = vi.fn();
		executeQuery = sdkMocks.executeQuery;
		executeMgmt = sdkMocks.executeMgmt;

		constructor(readonly clusterUrl: string) {
			sdkMocks.clients.push(this);
		}
	}
	return { Client, ClientRequestProperties };
});

import {
	isManagementCommand,
	isReadOnlyManagementCommand,
	startKustoManagementCommand,
	startKustoQuery,
	startKustoReadOnlyManagementCommandBatch
} from './query-client';

function response(rows: unknown[][] = [[1, 'value']]) {
	return {
		primaryResults: [
			{
				columns: [{ name: 'Count', type: 'long' }, {}],
				_rows: rows,
				rows: () => rows.map((values) => ({ getValueAt: (index: number) => values[index] }))
			}
		],
		getWarnings: () => ['warning']
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	sdkMocks.clients.length = 0;
	sdkMocks.properties.length = 0;
	sdkMocks.executeQuery.mockResolvedValue(response());
	sdkMocks.executeMgmt.mockResolvedValue(response());
});

const CLUSTER_URL = 'https://cluster.test';

describe('management command classification', () => {
	it('accepts commands that start with a period after whitespace', () => {
		expect(isManagementCommand('  .show tables')).toBe(true);
		expect(isManagementCommand('StormEvents | take 10')).toBe(false);
	});

	it('only treats inspection commands as read-only', () => {
		expect(isReadOnlyManagementCommand('.show tables')).toBe(true);
		expect(isReadOnlyManagementCommand(' .explain .show tables')).toBe(true);
		expect(isReadOnlyManagementCommand('.create table Metrics (Timestamp: datetime)')).toBe(false);
	});

	it('rejects empty and non-management command batches before execution', () => {
		expect(() => startKustoReadOnlyManagementCommandBatch('DB', [], CLUSTER_URL)).toThrow(
			'Provide at least one management command'
		);
		expect(() =>
			startKustoReadOnlyManagementCommandBatch('DB', ['Table | take 1'], CLUSTER_URL)
		).toThrow('Management commands must start with a period');
		expect(() =>
			startKustoReadOnlyManagementCommandBatch('DB', ['.drop table T'], CLUSTER_URL)
		).toThrow('Batched management commands must be read-only');
	});
});

describe('Kusto execution', () => {
	it('normalizes query results and configures request limits', async () => {
		const execution = startKustoQuery('Analytics', 'Events | count', 'https://cluster.test');

		await expect(execution.promise).resolves.toMatchObject({
			columns: [
				{ name: 'Count', type: 'long' },
				{ name: 'Column 2', type: 'unknown' }
			],
			rows: [[1, 'value']],
			totalRowCount: 1,
			renderedRowCount: 1,
			warnings: ['warning']
		});
		expect(sdkMocks.executeQuery).toHaveBeenCalledWith(
			'Analytics',
			'Events | count',
			expect.any(Object)
		);
		expect(sdkMocks.properties[0].application).toBe('Kite');
		expect(sdkMocks.properties[0].setTimeout).toHaveBeenCalledWith(60_000);
		expect(sdkMocks.properties[0].setClientTimeout).toHaveBeenCalledWith(90_000);
		expect(sdkMocks.properties[0].setOption).toHaveBeenCalledWith('truncationmaxrecords', 5_000);
		expect(sdkMocks.clients[0].close).toHaveBeenCalledOnce();
	});

	it('normalizes an empty primary result', async () => {
		sdkMocks.executeQuery.mockResolvedValueOnce({
			primaryResults: [],
			getWarnings: () => ['empty']
		});
		const result = await startKustoQuery('Analytics', 'print 1', CLUSTER_URL).promise;
		expect(result).toMatchObject({
			columns: [],
			rows: [],
			totalRowCount: 0,
			renderedRowCount: 0,
			warnings: ['empty']
		});
	});

	it('caps rendered rows while retaining the server row count', async () => {
		const rows = Array.from({ length: 1_002 }, (_, index) => [index, `row ${index}`]);
		sdkMocks.executeQuery.mockResolvedValueOnce(response(rows));
		const result = await startKustoQuery('Analytics', 'Events', CLUSTER_URL).promise;
		expect(result.renderedRowCount).toBe(1_000);
		expect(result.totalRowCount).toBe(1_002);
	});

	it('converts failures into cancellation after query cancellation', async () => {
		let rejectQuery!: (error: Error) => void;
		sdkMocks.executeQuery.mockReturnValueOnce(
			new Promise((_, reject) => {
				rejectQuery = reject;
			})
		);
		const execution = startKustoQuery('Analytics', 'Events', CLUSTER_URL);
		execution.cancel();
		rejectQuery(new Error('socket closed'));
		await expect(execution.promise).rejects.toThrow('Query cancelled.');
		expect(sdkMocks.clients[0].close).toHaveBeenCalled();
	});

	it('executes and cancels management commands through the management endpoint', async () => {
		const successful = startKustoManagementCommand('Analytics', '.show tables', CLUSTER_URL);
		await expect(successful.promise).resolves.toMatchObject({ totalRowCount: 1 });
		expect(sdkMocks.executeMgmt).toHaveBeenCalledWith(
			'Analytics',
			'.show tables',
			expect.any(Object)
		);
		expect(sdkMocks.properties[0].setTimeout).toHaveBeenCalledWith(600_000);

		let rejectCommand!: (error: Error) => void;
		sdkMocks.executeMgmt.mockReturnValueOnce(
			new Promise((_, reject) => {
				rejectCommand = reject;
			})
		);
		const cancelled = startKustoManagementCommand('Analytics', '.show databases', CLUSTER_URL);
		cancelled.cancel();
		rejectCommand(new Error('socket closed'));
		await expect(cancelled.promise).rejects.toThrow('Command cancelled.');
	});

	it('runs read-only command batches in order with distinct request ids', async () => {
		const execution = startKustoReadOnlyManagementCommandBatch(
			'Analytics',
			['.show tables', '.show functions'],
			CLUSTER_URL
		);
		await expect(execution.promise).resolves.toHaveLength(2);
		expect(sdkMocks.executeMgmt).toHaveBeenNthCalledWith(
			1,
			'Analytics',
			'.show tables',
			expect.any(Object)
		);
		expect(sdkMocks.executeMgmt).toHaveBeenNthCalledWith(
			2,
			'Analytics',
			'.show functions',
			expect.any(Object)
		);
		expect(sdkMocks.properties[0].clientRequestId).not.toBe(sdkMocks.properties[1].clientRequestId);
	});

	it('stops a command batch after cancellation', async () => {
		let resolveFirst!: (value: ReturnType<typeof response>) => void;
		sdkMocks.executeMgmt.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveFirst = resolve;
			})
		);
		const execution = startKustoReadOnlyManagementCommandBatch(
			'Analytics',
			['.show tables', '.show functions'],
			CLUSTER_URL
		);
		execution.cancel();
		resolveFirst(response());
		await expect(execution.promise).rejects.toThrow('Command cancelled.');
		expect(sdkMocks.executeMgmt).toHaveBeenCalledOnce();
	});

	it('rejects non-management commands before creating a client', () => {
		expect(() => startKustoManagementCommand('Analytics', 'Events | take 1', CLUSTER_URL)).toThrow(
			'Management commands must start'
		);
		expect(sdkMocks.clients).toHaveLength(0);
	});
});
