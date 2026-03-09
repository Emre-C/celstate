<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		class: className = ''
	}: {
		children: Snippet;
		class?: string;
	} = $props();
</script>

<span class="font-mono text-[10px] tracking-[0.15em] uppercase text-dim {className}">
	{@render children()}
</span>
