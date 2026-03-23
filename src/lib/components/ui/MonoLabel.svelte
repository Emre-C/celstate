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

<span class="text-[10px] font-medium uppercase tracking-[0.06em] text-dim {className}">
	{@render children()}
</span>
