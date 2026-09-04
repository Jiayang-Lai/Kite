<script lang="ts">
	import type { Snippet } from 'svelte';

	import { createAppShellState, setAppShellState } from '$lib/app/app-shell-state.svelte';
	import {
		createAzureAuthenticationProfileStore,
		setAzureAuthenticationProfileStore
	} from '$lib/azure-auth/profile-store.svelte';
	import {
		createClusterConnectionStore,
		setClusterConnectionStore
	} from '$lib/cluster/cluster-connection-store.svelte';
	import { createClusterSession, setClusterSession } from '$lib/cluster/cluster-session.svelte';
	import { getKustoClusters } from '$lib/cluster/connections';
	import {
		createRecentQueryStore,
		setRecentQueryStore
	} from '$lib/query/recent-query-store.svelte';
	import { createSavedQueryStore, setSavedQueryStore } from '$lib/query/saved-query-store.svelte';

	let { children }: { children: Snippet } = $props();
	const initialClusterId = getKustoClusters()[0].id;
	const clusterSession = createClusterSession(initialClusterId);
	clusterSession.databaseSchema = {
		Samples: {
			name: 'Samples',
			tables: [{ name: 'Events', columns: [{ name: 'Message', type: 'string' }] }]
		}
	};
	clusterSession.selectedDatabase = 'Samples';
	clusterSession.updateQueryTab(clusterSession.activeQueryTabId, {
		database: 'Samples',
		query: 'Events | count'
	});

	setAppShellState(createAppShellState(() => true));
	setAzureAuthenticationProfileStore(createAzureAuthenticationProfileStore());
	setClusterConnectionStore(createClusterConnectionStore());
	setClusterSession(clusterSession);
	setRecentQueryStore(createRecentQueryStore());
	setSavedQueryStore(createSavedQueryStore());
</script>

{@render children()}
