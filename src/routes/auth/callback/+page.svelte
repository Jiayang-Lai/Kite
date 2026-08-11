<script lang="ts">
	import { onMount } from 'svelte';

	// This bridge needs `window` and `document`, so it must run only after the
	// callback page has mounted in the popup browser window.
	onMount(() => {
		void import('@azure/msal-browser/redirect-bridge').then(({ broadcastResponseToMainFrame }) =>
			broadcastResponseToMainFrame()
		);
	});
</script>

<svelte:head><title>Completing authentication</title></svelte:head>

<p>Completing authentication…</p>
