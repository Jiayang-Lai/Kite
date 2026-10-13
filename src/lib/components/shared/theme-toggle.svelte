<script lang="ts">
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { toggleMode } from 'mode-watcher';

	import { Button } from '$lib/components/ui/button';
</script>

<Button
	variant="outline"
	size="icon-sm"
	onclick={toggleMode}
	title="Toggle color theme"
	aria-label="Toggle color theme"
>
	<SunIcon class="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
	<MoonIcon class="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
	<span class="sr-only">Toggle color theme</span>
</Button>
