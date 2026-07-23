<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';

	import { cn } from '$lib/utils';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DialogPrimitive.OverlayProps = $props();
</script>

<DialogPrimitive.Overlay
	bind:ref
	data-slot="dialog-overlay"
	class={cn(
		'fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0',
		className
	)}
	{...restProps}
/>
