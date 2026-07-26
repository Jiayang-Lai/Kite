import { describe, expect, it } from 'vitest';

import { createClusterSession } from './cluster-session.svelte';

describe('cluster explorer expansion', () => {
	it('persists expansion per cluster across consumers', () => {
		const session = createClusterSession('cluster-a');

		expect(session.getExplorerExpansion('cluster-a')).toEqual({
			databases: {},
			groups: {},
			schemaTables: {},
			sections: { 'saved-queries': false, 'recent-queries': false }
		});

		session.setExplorerExpansion('cluster-a', {
			type: 'schema-table',
			database: 'MetricsDb',
			table: 'Events',
			open: true
		});
		session.setExplorerExpansion('cluster-a', {
			type: 'section',
			section: 'saved-queries',
			open: true
		});

		expect(session.getExplorerExpansion('cluster-a').schemaTables.MetricsDb.Events).toBe(true);
		expect(session.getExplorerExpansion('cluster-a').sections['saved-queries']).toBe(true);
		expect(session.getExplorerExpansion('cluster-b')).toEqual({
			databases: {},
			groups: {},
			schemaTables: {},
			sections: { 'saved-queries': false, 'recent-queries': false }
		});
	});
});
