<script lang="ts">
	import { onMount } from 'svelte';

	import { createAppShellState, setAppShellState } from '$lib/app/app-shell-state.svelte';
	import { getPersistedActiveClusterId } from '$lib/cluster/active-cluster-preference';
	import {
		createClusterConnectionStore,
		setClusterConnectionStore
	} from '$lib/cluster/cluster-connection-store.svelte';
	import { releaseAllClusterRuntimes } from '$lib/cluster/cluster-runtime';
	import {
		createAzureAuthenticationProfileStore,
		setAzureAuthenticationProfileStore
	} from '$lib/azure-auth/profile-store.svelte';
	import { createClusterSession, setClusterSession } from '$lib/cluster/cluster-session.svelte';
	import { getKustoClusters } from '$lib/cluster/connections';
	import {
		createRecentQueryStore,
		setRecentQueryStore
	} from '$lib/query/recent-query-store.svelte';
	import { createSavedQueryStore, setSavedQueryStore } from '$lib/query/saved-query-store.svelte';

	let { data, children } = $props();

	const appShellState = createAppShellState(() => data.sidebarOpen);
	setAppShellState(appShellState);
	const clusters = getKustoClusters();
	const persistedClusterId = getPersistedActiveClusterId();
	const initialClusterId =
		clusters.find((cluster) => cluster.id === persistedClusterId)?.id ?? clusters[0].id;
	setClusterSession(createClusterSession(initialClusterId));
	const clusterConnectionStore = createClusterConnectionStore();
	setClusterConnectionStore(clusterConnectionStore);
	const azureAuthenticationProfileStore = createAzureAuthenticationProfileStore();
	setAzureAuthenticationProfileStore(azureAuthenticationProfileStore);
	const recentQueryStore = createRecentQueryStore();
	setRecentQueryStore(recentQueryStore);
	const savedQueryStore = createSavedQueryStore();
	setSavedQueryStore(savedQueryStore);

	onMount(() => {
		clusterConnectionStore.hydrate();
		azureAuthenticationProfileStore.hydrate();
		recentQueryStore.hydrate();
		savedQueryStore.hydrate();

		return () => {
			void releaseAllClusterRuntimes();
		};
	});
</script>

{@render children()}
