import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';

export const MOCK_DATABASES: KustoDatabaseSchema = {
	Samples: {
		name: 'Samples',
		functions: [
			{
				name: 'RecentStormEvents',
				body: '{ StormEvents | where StartTime > ago(lookback) }',
				docstring: 'Returns storm events that started within the requested lookback window.',
				inputParameters: [
					{
						name: 'lookback',
						type: 'timespan',
						cslDefaultValue: '7d',
						docstring: 'Amount of time before now to include.'
					}
				]
			},
			{
				name: 'PopulationByRegion',
				body: '{ PopulationData | where Region == region }',
				docstring: 'Returns population records belonging to a geographic region.',
				inputParameters: [
					{
						name: 'region',
						type: 'string',
						docstring: 'Region name to match, such as West or Northeast.'
					}
				]
			}
		],
		tables: [
			{
				name: 'StormEvents',
				docstring: 'Sample weather events for testing KQL autocomplete.',
				columns: [
					{ name: 'StartTime', type: 'datetime' },
					{ name: 'EndTime', type: 'datetime' },
					{ name: 'State', type: 'string' },
					{ name: 'EventType', type: 'string' },
					{ name: 'DamageProperty', type: 'long' }
				]
			},
			{
				name: 'PopulationData',
				columns: [
					{ name: 'State', type: 'string' },
					{ name: 'Population', type: 'long' },
					{ name: 'Region', type: 'string' }
				]
			}
		]
	},
	Telemetry: {
		name: 'Telemetry',
		functions: [
			{
				name: 'FailedRequests',
				body: '{ AppRequests | where Timestamp > ago(lookback) and Success == false }',
				docstring: 'Returns failed application requests from the requested time window.',
				inputParameters: [
					{
						name: 'lookback',
						type: 'timespan',
						cslDefaultValue: '1h',
						docstring: 'Amount of request history to inspect.'
					}
				]
			},
			{
				name: 'SlowRequests',
				body: '{ AppRequests | where DurationMs >= thresholdMs }',
				docstring: 'Returns requests whose duration meets or exceeds a threshold.',
				inputParameters: [
					{
						name: 'thresholdMs',
						type: 'real',
						cslDefaultValue: '1000.0',
						docstring: 'Minimum request duration in milliseconds.'
					}
				]
			}
		],
		tables: [
			{
				name: 'AppRequests',
				columns: [
					{ name: 'Timestamp', type: 'datetime' },
					{ name: 'OperationName', type: 'string' },
					{ name: 'DurationMs', type: 'real' },
					{ name: 'Success', type: 'bool' },
					{ name: 'TenantId', type: 'string' }
				]
			},
			{
				name: 'AppExceptions',
				columns: [
					{ name: 'Timestamp', type: 'datetime' },
					{ name: 'ProblemId', type: 'string' },
					{ name: 'Assembly', type: 'string' },
					{ name: 'SeverityLevel', type: 'int' }
				]
			}
		]
	},
	Ops: {
		name: 'Ops',
		functions: [
			{
				name: 'UnhealthyClusters',
				body: '{ ClusterHealth | where Timestamp > ago(lookback) and IsHealthy == false }',
				docstring: 'Returns unhealthy cluster health samples from a recent time window.',
				inputParameters: [
					{
						name: 'lookback',
						type: 'timespan',
						cslDefaultValue: '24h',
						docstring: 'Amount of cluster health history to include.'
					}
				]
			},
			{
				name: 'RecentCommandsForPrincipal',
				body: '{ CommandAudit | where Timestamp > ago(lookback) and User == principalName }',
				docstring: 'Returns recent audited commands issued by a particular principal.',
				inputParameters: [
					{
						name: 'principalName',
						type: 'string',
						docstring: 'User or service-principal name to match.'
					},
					{
						name: 'lookback',
						type: 'timespan',
						cslDefaultValue: '24h',
						docstring: 'Amount of command history to inspect.'
					}
				]
			}
		],
		tables: [
			{
				name: 'ClusterHealth',
				columns: [
					{ name: 'Timestamp', type: 'datetime' },
					{ name: 'ClusterName', type: 'string' },
					{ name: 'CpuPercent', type: 'real' },
					{ name: 'MemoryPercent', type: 'real' },
					{ name: 'IsHealthy', type: 'bool' }
				]
			},
			{
				name: 'CommandAudit',
				columns: [
					{ name: 'Timestamp', type: 'datetime' },
					{ name: 'User', type: 'string' },
					{ name: 'CommandType', type: 'string' },
					{ name: 'DurationMs', type: 'real' }
				]
			}
		]
	}
};
