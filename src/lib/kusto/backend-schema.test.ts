import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
	clients: [] as Array<{ clusterUrl: string; close: ReturnType<typeof vi.fn> }>,
	executeMgmt: vi.fn<(database: string, command: string) => Promise<unknown>>()
}));

vi.mock('azure-kusto-data', () => {
	class Client {
		close = vi.fn();
		executeMgmt = sdkMocks.executeMgmt;

		constructor(readonly clusterUrl: string) {
			sdkMocks.clients.push(this);
		}
	}
	return { Client };
});

import { loadBackendSchema, parseBackendSchema } from './backend-schema';

/** A management-command response whose primary result holds `rows`, as the SDK returns it. */
function response(rows: Record<string, unknown>[]) {
	return { primaryResults: [{ rows: () => rows[Symbol.iterator]() }] };
}

function showSchema(databaseName: string, tableName: string) {
	return JSON.stringify({
		Databases: {
			[databaseName]: {
				Name: databaseName,
				Tables: {
					[tableName]: {
						Name: tableName,
						OrderedColumns: [{ Name: 'Id', Type: 'System.Int64', CslType: 'long' }]
					}
				}
			}
		}
	});
}

/** Serves `.show databases details` and one `.show database schema as json` per database. */
function serveDatabases(databases: { name: string; prettyName?: unknown; table: string }[]) {
	sdkMocks.executeMgmt.mockImplementation(async (database, command) => {
		if (command === '.show databases details') {
			return response(
				databases.map(({ name, prettyName }) => ({ DatabaseName: name, PrettyName: prettyName }))
			);
		}
		const match = databases.find(({ name }) => name === database);
		return response(match ? [{ DatabaseSchema: showSchema(match.name, match.table) }] : []);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	sdkMocks.clients.length = 0;
});

describe('parseBackendSchema', () => {
	it('maps show-schema tables, columns, functions, and versions', () => {
		const schema = parseBackendSchema(
			JSON.stringify({
				Databases: {
					NetDefaultDB: {
						Name: 'NetDefaultDB',
						MajorVersion: 3,
						MinorVersion: 2,
						Tables: {
							metrics: {
								Name: 'metrics',
								DocString: 'Telemetry metrics.',
								OrderedColumns: [
									{ Name: 'timestamp', Type: 'System.DateTime', CslType: 'datetime' },
									{ Name: 'value', Type: 'System.Double', CslType: 'real' }
								]
							}
						},
						Functions: {
							RecentMetrics: {
								Name: 'RecentMetrics',
								Body: '{ metrics | where timestamp > ago(lookback) }',
								DocString: 'Returns recent metrics.',
								InputParameters: [
									{ Name: 'lookback', Type: 'System.TimeSpan', CslType: 'timespan' }
								]
							}
						}
					}
				}
			})
		);

		expect(schema.NetDefaultDB).toMatchObject({
			name: 'NetDefaultDB',
			majorVersion: 3,
			minorVersion: 2,
			tables: [
				{
					name: 'metrics',
					docstring: 'Telemetry metrics.',
					columns: [
						{ name: 'timestamp', type: 'datetime' },
						{ name: 'value', type: 'real' }
					]
				}
			],
			functions: [
				{
					name: 'RecentMetrics',
					body: '{ metrics | where timestamp > ago(lookback) }',
					docstring: 'Returns recent metrics.',
					inputParameters: [{ name: 'lookback', type: 'timespan', cslType: 'timespan' }]
				}
			]
		});
	});

	it('returns an empty schema when the payload has no databases', () => {
		expect(parseBackendSchema('{}')).toEqual({});
	});

	it('falls back to the .NET type, then dynamic, and to version 1.0 when fields are missing', () => {
		const schema = parseBackendSchema(
			JSON.stringify({
				Databases: {
					Logs: {
						Name: 'Logs',
						Tables: {
							Events: {
								Name: 'Events',
								OrderedColumns: [{ Name: 'Raw', Type: 'System.Object' }, { Name: 'Untyped' }]
							},
							Empty: { Name: 'Empty' }
						},
						Functions: { NoArgs: { Name: 'NoArgs', Body: '{ print 1 }' } }
					}
				}
			})
		);

		expect(schema.Logs).toMatchObject({
			majorVersion: 1,
			minorVersion: 0,
			tables: [
				{
					name: 'Events',
					columns: [
						{ name: 'Raw', type: 'System.Object' },
						{ name: 'Untyped', type: 'dynamic' }
					]
				},
				{ name: 'Empty', columns: [] }
			],
			functions: [{ name: 'NoArgs', inputParameters: [] }]
		});
	});
});

describe('loadBackendSchema', () => {
	it('loads every database on the cluster and keeps trimmed pretty names', async () => {
		serveDatabases([
			{ name: 'Sales', prettyName: '  Sales (EU)  ', table: 'Orders' },
			{ name: 'Logs', prettyName: '   ', table: 'Events' },
			{ name: 'Audit', prettyName: null, table: 'Changes' }
		]);

		const schema = await loadBackendSchema('http://localhost:8080');

		expect(Object.keys(schema)).toEqual(['Sales', 'Logs', 'Audit']);
		expect(schema.Sales.prettyName).toBe('Sales (EU)');
		expect(schema.Logs.prettyName).toBeUndefined();
		expect(schema.Audit.prettyName).toBeUndefined();
		expect(schema.Sales.tables.map((table) => table.name)).toEqual(['Orders']);
		expect(sdkMocks.clients.map((client) => client.clusterUrl)).toEqual(['http://localhost:8080']);
		expect(sdkMocks.clients[0].close).toHaveBeenCalledOnce();
	});

	it('fails when the cluster reports no databases', async () => {
		serveDatabases([]);

		await expect(loadBackendSchema('http://localhost:8080')).rejects.toThrow(
			'The Kusto backend returned no databases.'
		);
		expect(sdkMocks.clients[0].close).toHaveBeenCalledOnce();
	});

	it('fails when a database returns no schema, and still closes the client', async () => {
		serveDatabases([{ name: 'Sales', table: 'Orders' }]);
		const showDatabases = sdkMocks.executeMgmt.getMockImplementation()!;
		sdkMocks.executeMgmt.mockImplementation(async (database, command) =>
			command === '.show databases details'
				? showDatabases(database, command)
				: response([{ DatabaseSchema: null }])
		);

		await expect(loadBackendSchema('http://localhost:8080')).rejects.toThrow(
			'The backend returned no schema for Sales.'
		);
		expect(sdkMocks.clients[0].close).toHaveBeenCalledOnce();
	});

	it('closes the client when a management command fails', async () => {
		sdkMocks.executeMgmt.mockRejectedValue(new Error('connection refused'));

		await expect(loadBackendSchema('http://localhost:8080')).rejects.toThrow('connection refused');
		expect(sdkMocks.clients[0].close).toHaveBeenCalledOnce();
	});
});
