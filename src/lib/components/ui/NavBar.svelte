<script lang="ts">
	import type { Snippet } from 'svelte';
	import Logo from '$lib/components/Logo.svelte';

	let {
		children,
		compact = false,
		/** Match `PageContainer` so nav lines up with main content (`4xl` on /app, `6xl` on marketing). */
		max = '6xl'
	}: {
		children?: Snippet;
		compact?: boolean;
		max?: '4xl' | '6xl';
	} = $props();

	const maxClass = $derived(max === '4xl' ? 'max-w-4xl' : 'max-w-6xl');
</script>

<nav class="fixed top-0 left-0 right-0 z-50 border-b border-border bg-bg/90 backdrop-blur-md">
	<div
		class="mx-auto flex {maxClass} flex-nowrap items-center justify-between gap-4 px-6 {compact ? 'py-3' : 'py-4'}"
	>
		<a
			href="/"
			class="flex shrink-0 items-center gap-2.5 whitespace-nowrap text-text transition-colors hover:text-accent"
		>
			<Logo class="{compact ? 'h-5 w-5' : 'h-6 w-6'} shrink-0" />
			<span class="{compact ? 'text-base' : 'text-lg'} font-display italic tracking-tight">celstate</span>
		</a>
		{#if children}
			<div class="shrink-0">
				{@render children()}
			</div>
		{/if}
	</div>
</nav>
