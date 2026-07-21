<script lang="ts">
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';

	type ConnectionFailureDialogProps = {
		failedClusterName: string;
		activeClusterName: string;
		error: string;
		oncontinue: () => void;
		onretry: () => void;
	};

	let {
		failedClusterName,
		activeClusterName,
		error,
		oncontinue,
		onretry
	}: ConnectionFailureDialogProps = $props();
</script>

<section
	class="absolute inset-0 z-30 grid place-items-center bg-background/80 p-4 backdrop-blur-[1px]"
	role="alert"
	aria-live="assertive"
>
	<Card.Root size="sm" class="w-full max-w-lg border-amber-500/30 bg-background shadow-lg">
		<Card.Header class="grid-cols-[auto_1fr] gap-x-3">
			<TriangleAlertIcon
				class="row-span-2 mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
			/>
			<Card.Title>Could not connect to {failedClusterName}</Card.Title>
			<Card.Description>
				Your current cluster is still available. Review the connection details below, then retry or
				continue working with {activeClusterName}.
			</Card.Description>
		</Card.Header>

		<Card.Content>
			<p
				class="text-muted-foreground max-h-28 overflow-y-auto whitespace-pre-wrap rounded-md bg-background/70 p-2 font-mono text-xs"
			>
				{error}
			</p>
		</Card.Content>

		<Card.Footer class="justify-end gap-2">
			<Button size="sm" variant="outline" onclick={oncontinue}>
				Continue with {activeClusterName}
			</Button>
			<Button size="sm" onclick={onretry}>
				<RefreshCwIcon />
				Retry
			</Button>
		</Card.Footer>
	</Card.Root>
</section>
