import { describe, expect, it } from 'vitest';

import { createKustoSchema } from './schema';

describe('createKustoSchema', () => {
	const schema = {
		Active: {
			name: 'Active',
			tables: [
				{
					name: 'Events',
					docstring: 'The active event catalog.',
					columns: [
						{ name: 'Timestamp', type: 'datetime' },
						{ name: 'Message', type: 'string' }
					]
				}
			],
			functions: [
				{
					name: 'RecentEvents',
					body: '{ Events | take 10 }',
					inputParameters: []
				}
			]
		},
		Archive: {
			name: 'Archive',
			alternateName: 'Archived data',
			tables: [
				{
					name: 'OldEvents',
					entityType: 'ExternalTable' as const,
					docstring: 'Large historical dataset.',
					columns: [
						{ name: 'Timestamp', type: 'datetime', docstring: 'Event time.' },
						{ name: 'Payload', type: 'dynamic', examples: ['{"region":"west"}'] }
					]
				}
			],
			functions: [
				{
					name: 'OldEventsForRegion',
					body: '{ OldEvents | where Region == region }',
					inputParameters: [{ name: 'region', type: 'string' }]
				}
			],
			graphs: [
				{
					name: 'DependencyGraph',
					entityType: 'Graph' as const,
					edges: [],
					nodes: [],
					snapshots: []
				}
			],
			entityGroups: [{ name: 'ArchiveGroup', members: ['OldEvents'] }]
		}
	};

	it('keeps the selected database complete and shares it with the cluster catalog', () => {
		const result = createKustoSchema(schema, 'Active', 'https://example.kusto.windows.net');

		expect(result.database).toBe(result.cluster.databases[0]);
		expect(result.database).toMatchObject({
			name: 'Active',
			tables: [{ name: 'Events', columns: [{ name: 'Timestamp' }, { name: 'Message' }] }],
			functions: [{ name: 'RecentEvents' }]
		});
	});

	it('retains inactive database and table names but strips heavyweight metadata', () => {
		const result = createKustoSchema(schema, 'Active');
		const archive = result.cluster.databases.find((database) => database.name === 'Archive');

		expect(archive).toEqual({
			name: 'Archive',
			alternateName: 'Archived data',
			tables: [{ name: 'OldEvents', entityType: 'ExternalTable', columns: [] }],
			functions: [],
			graphs: [],
			entityGroups: [],
			majorVersion: 1,
			minorVersion: 0
		});
	});

	it('hydrates a database fully when it becomes active', () => {
		const result = createKustoSchema(schema, 'Archive');
		const archive = result.database;

		expect(archive).toMatchObject({
			name: 'Archive',
			tables: [
				{
					name: 'OldEvents',
					columns: [{ name: 'Timestamp' }, { name: 'Payload' }]
				}
			],
			functions: [{ name: 'OldEventsForRegion' }],
			graphs: [{ name: 'DependencyGraph' }],
			entityGroups: [{ name: 'ArchiveGroup' }]
		});
	});
});
