<script lang="ts">
	import ConfirmationDialog from '$lib/components/admin/confirmation-dialog.svelte';

	type TableDropDialogProps = {
		open?: boolean;
		databaseName: string;
		tableName: string;
		clusterKind: 'mock' | 'emulated' | 'remote';
		onsubmit?: () => Promise<void> | void;
	};

	let {
		open = $bindable(false),
		databaseName,
		tableName,
		clusterKind,
		onsubmit
	}: TableDropDialogProps = $props();
	const confirmationPhrase = $derived(`REMOVE ${tableName}`);
	const description = $derived(
		clusterKind === 'mock'
			? `Remove ${databaseName}.${tableName} from this browser-local schema.`
			: clusterKind === 'emulated'
				? `Permanently remove ${databaseName}.${tableName} and its browser DuckDB data.`
				: `Permanently delete ${databaseName}.${tableName} and all data stored in it.`
	);
</script>

<ConfirmationDialog
	bind:open
	title="Remove table"
	{description}
	descriptionId="table-drop-description"
	actionLabel="Remove table"
	{confirmationPhrase}
	confirmationLabel={`Type ${confirmationPhrase} to confirm`}
	{onsubmit}
/>
