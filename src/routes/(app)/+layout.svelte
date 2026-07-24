<script lang="ts">
	import { onMount } from 'svelte';

	import { createAppShellState, setAppShellState } from '$lib/app/app-shell-state.svelte';
	import { getPersistedActiveClusterId } from '$lib/cluster/active-cluster-preference';
	import {
		createClusterConnectionStore,
		setClusterConnectionStore
	} from '$lib/cluster/cluster-connection-store.svelte';
	import { createClusterSession, setClusterSession } from '$lib/cluster/cluster-session.svelte';
	import { SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants.js';
	import { getKustoClusters } from '$lib/kusto/query-client';
	import {
		createRecentQueryStore,
		setRecentQueryStore
	} from '$lib/query/recent-query-store.svelte';
	import { createSavedQueryStore, setSavedQueryStore } from '$lib/query/saved-query-store.svelte';

	let { children } = $props();

	const appShellState = createAppShellState();
	setAppShellState(appShellState);
	const clusters = getKustoClusters();
	const persistedClusterId = getPersistedActiveClusterId();
	const initialClusterId =
		clusters.find((cluster) => cluster.id === persistedClusterId)?.id ?? clusters[0].id;
	setClusterSession(createClusterSession(initialClusterId));
	const clusterConnectionStore = createClusterConnectionStore();
	setClusterConnectionStore(clusterConnectionStore);
	const recentQueryStore = createRecentQueryStore();
	setRecentQueryStore(recentQueryStore);
	const savedQueryStore = createSavedQueryStore();
	setSavedQueryStore(savedQueryStore);

	onMount(() => {
		const sidebarCookie = document.cookie
			.split('; ')
			.find((cookie) => cookie.startsWith(`${SIDEBAR_COOKIE_NAME}=`));
		if (sidebarCookie) {
			appShellState.sidebarOpen = sidebarCookie.split('=')[1] !== 'false';
		}

		clusterConnectionStore.hydrate();
		recentQueryStore.hydrate();
		savedQueryStore.hydrate();
	});
</script>

{@render children()}
