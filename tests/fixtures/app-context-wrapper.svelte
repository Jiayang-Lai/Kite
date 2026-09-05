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
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { MOCK_DATABASES } from '$lib/data/mock-databases';
	import {
		createRecentQueryStore,
		setRecentQueryStore
	} from '$lib/query/recent-query-store.svelte';
	import { createSavedQueryStore, setSavedQueryStore } from '$lib/query/saved-query-store.svelte';

	let { children }: { children: Snippet } = $props();
	const initialClusterId = getKustoClusters()[0].id;
	const profiles = createAzureAuthenticationProfileStore();
	const connections = createClusterConnectionStore();
	const session = createClusterSession(initialClusterId);
	session.databaseSchema = MOCK_DATABASES;
	session.selectedDatabase = 'Samples';

	profiles.hydrate();
	connections.hydrate();
	setAppShellState(createAppShellState(() => true));
	setAzureAuthenticationProfileStore(profiles);
	setClusterConnectionStore(connections);
	setClusterSession(session);
	setRecentQueryStore(createRecentQueryStore());
	setSavedQueryStore(createSavedQueryStore());
</script>

<Sidebar.Provider>
	{@render children()}
</Sidebar.Provider>
