<script lang="ts">
	import type { Snippet } from 'svelte';
	import Logo from '$lib/components/Logo.svelte';

	let {
		children,
		compact = false
	}: {
		children?: Snippet;
		compact?: boolean;
	} = $props();
</script>

<nav class="fixed top-0 left-0 right-0 z-50 border-b border-border bg-bg/80 backdrop-blur-md">
	<div class="mx-auto flex max-w-6xl items-center justify-between px-6 {compact ? 'py-3' : 'py-4'}">
		<a href="/" class="flex items-center gap-2.5 text-text transition-colors hover:text-accent">
			<Logo class={compact ? 'h-5 w-5' : 'h-6 w-6'} />
			<span class="{compact ? 'text-base' : 'text-lg'} font-light tracking-tight">celstate</span>
		</a>
		{#if children}
			{@render children()}
		{/if}
	</div>
</nav>
