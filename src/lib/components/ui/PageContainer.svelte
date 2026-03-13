<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		max = '6xl',
		class: className = ''
	}: {
		children: Snippet;
		max?: '4xl' | '6xl';
		class?: string;
	} = $props();

	const maxClass = $derived(max === '4xl' ? 'max-w-4xl' : 'max-w-6xl');
</script>

<div class="mx-auto {maxClass} px-6 {className}">
	{@render children()}
</div>
