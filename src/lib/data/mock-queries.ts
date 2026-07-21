/** Fixed query history used only by Kite's in-memory mock cluster. */
export const MOCK_RECENT_QUERIES = [
	{ name: 'StormEvents schema', database: 'Samples', query: 'StormEvents\n| getschema' },
	{ name: 'PopulationData schema', database: 'Samples', query: 'PopulationData\n| getschema' },
	{ name: 'AppRequests schema', database: 'Telemetry', query: 'AppRequests\n| getschema' }
];

/** Fixed saved-query examples used only by Kite's in-memory mock cluster. */
export const MOCK_SAVED_QUERIES = [
	{ name: 'Count StormEvents records', database: 'Samples', query: 'StormEvents\n| count' },
	{ name: 'Count AppRequests records', database: 'Telemetry', query: 'AppRequests\n| count' },
	{ name: 'Count ClusterHealth records', database: 'Ops', query: 'ClusterHealth\n| count' }
];
