import { flushSync } from 'svelte';
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

	it('reports the first change for a connection to a derived reader', () => {
		const session = createClusterSession('cluster-a');
		let open = false;
		const cleanup = $effect.root(() => {
			const expansion = $derived(session.getExplorerExpansion('cluster-b'));
			$effect(() => {
				open = Boolean(expansion.databases.Samples);
			});
		});
		flushSync();
		expect(open).toBe(false);

		session.setExplorerExpansion('cluster-b', {
			type: 'database',
			database: 'Samples',
			open: true
		});
		flushSync();
		expect(open).toBe(true);
		expect(session.getExplorerExpansion('cluster-b').databases.Samples).toBe(true);

		session.setExplorerExpansion('cluster-b', {
			type: 'database',
			database: 'Samples',
			open: false
		});
		flushSync();
		expect(open).toBe(false);
		cleanup();
	});
});
