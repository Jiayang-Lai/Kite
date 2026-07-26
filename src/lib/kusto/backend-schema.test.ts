import { describe, expect, it } from 'vitest';

import { parseBackendSchema } from './backend-schema';

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
});
