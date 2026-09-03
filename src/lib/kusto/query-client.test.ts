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
	getKustoErrorMessage,
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

describe('getKustoErrorMessage', () => {
	it('preserves the complete text response and HTTP status', () => {
		const error = Object.assign(new Error('Request failed with status code 400'), {
			response: {
				status: 400,
				statusText: 'BadRequest',
				data: `General_BadRequest: Request is invalid and cannot be executed.
Error details:
ClientRequestId='Kite.Query;123', ActivityId='activity-123', Timestamp='2026-07-14T23:05:33Z'.`,
				headers: { 'x-ms-activity-id': 'activity-123' }
			}
		});

		expect(getKustoErrorMessage(error)).toBe(`HTTP 400 BadRequest

General_BadRequest: Request is invalid and cannot be executed.
Error details:
ClientRequestId='Kite.Query;123', ActivityId='activity-123', Timestamp='2026-07-14T23:05:33Z'.`);
	});

	it('formats structured Kusto errors and activity IDs', () => {
		const error = Object.assign(new Error('Bad request'), {
			response: {
				status: 400,
				data: { error: { code: 'SemanticError', message: 'Unknown column X.' } },
				headers: { 'x-ms-activity-id': 'activity-456' }
			}
		});

		expect(getKustoErrorMessage(error)).toBe(`HTTP 400

SemanticError: Unknown column X.

Activity ID: activity-456`);
	});

	it('prefers actionable details from a nested Kusto exception', () => {
		const error = Object.assign(new Error('Request failed with status code 400'), {
			response: {
				status: 400,
				statusText: 'Bad Request',
				data: {
					error: {
						code: 'General_BadRequest',
						message: 'Request is invalid and cannot be executed.',
						'@message':
							'Request is invalid and cannot be processed: Syntax error: SYN0002: Missing expression [line:position=2:7]',
						'@database': 'NetDefaultDB',
						'@context': {
							clientRequestId: 'Kite.Query;123',
							activityId: 'activity-123'
						},
						innererror: {
							code: 'SYN0002',
							message: 'Missing expression',
							'@message': 'Syntax error: SYN0002: Missing expression [line:position=2:7]',
							'@line': '2',
							'@pos': '7',
							'@errorCode': 'SYN0002',
							'@errorMessage': 'Missing expression'
						}
					}
				},
				headers: { 'x-ms-activity-id': 'activity-123' }
			}
		});

		expect(getKustoErrorMessage(error)).toBe(`HTTP 400 Bad Request

SYN0002: Missing expression
Syntax error: SYN0002: Missing expression [line:position=2:7]
Line 2, column 7
Database: NetDefaultDB
Client request ID: Kite.Query;123
Activity ID: activity-123`);
	});

	it('parses a JSON Kusto error returned as text', () => {
		const error = Object.assign(new Error('Bad request'), {
			response: {
				status: 400,
				data: JSON.stringify({
					error: {
						code: 'General_BadRequest',
						message: 'Request is invalid.',
						innererror: { code: 'SEM0100', message: 'Unknown column X' }
					}
				})
			}
		});

		expect(getKustoErrorMessage(error)).toBe(`HTTP 400

SEM0100: Unknown column X`);
	});
});

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
		expect(() => startKustoReadOnlyManagementCommandBatch('DB', [])).toThrow(
			'Provide at least one management command'
		);
		expect(() => startKustoReadOnlyManagementCommandBatch('DB', ['Table | take 1'])).toThrow(
			'Management commands must start with a period'
		);
		expect(() => startKustoReadOnlyManagementCommandBatch('DB', ['.drop table T'])).toThrow(
			'Batched management commands must be read-only'
		);
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
		const result = await startKustoQuery('Analytics', 'print 1').promise;
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
		const result = await startKustoQuery('Analytics', 'Events').promise;
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
		const execution = startKustoQuery('Analytics', 'Events');
		execution.cancel();
		rejectQuery(new Error('socket closed'));
		await expect(execution.promise).rejects.toThrow('Query cancelled.');
		expect(sdkMocks.clients[0].close).toHaveBeenCalled();
	});

	it('executes and cancels management commands through the management endpoint', async () => {
		const successful = startKustoManagementCommand('Analytics', '.show tables');
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
		const cancelled = startKustoManagementCommand('Analytics', '.show databases');
		cancelled.cancel();
		rejectCommand(new Error('socket closed'));
		await expect(cancelled.promise).rejects.toThrow('Command cancelled.');
	});

	it('runs read-only command batches in order with distinct request ids', async () => {
		const execution = startKustoReadOnlyManagementCommandBatch('Analytics', [
			'.show tables',
			'.show functions'
		]);
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
		const execution = startKustoReadOnlyManagementCommandBatch('Analytics', [
			'.show tables',
			'.show functions'
		]);
		execution.cancel();
		resolveFirst(response());
		await expect(execution.promise).rejects.toThrow('Command cancelled.');
		expect(sdkMocks.executeMgmt).toHaveBeenCalledOnce();
	});

	it('rejects non-management commands before creating a client', () => {
		expect(() => startKustoManagementCommand('Analytics', 'Events | take 1')).toThrow(
			'Management commands must start'
		);
		expect(sdkMocks.clients).toHaveLength(0);
	});
});
