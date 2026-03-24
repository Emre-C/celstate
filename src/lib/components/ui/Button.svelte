<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		variant = 'primary',
		href,
		disabled = false,
		fullWidth = false,
		onclick,
		class: className = ''
	}: {
		children: Snippet;
		variant?: 'primary' | 'secondary' | 'ghost';
		href?: string;
		disabled?: boolean;
		fullWidth?: boolean;
		onclick?: (e: MouseEvent) => void;
		class?: string;
	} = $props();

	const base = 'rounded-full py-2.5 text-sm font-medium transition-colors';

	const variants: Record<string, string> = {
		primary:   'bg-accent text-white hover:bg-accent/90',
		secondary: 'border border-border text-text hover:border-accent hover:text-accent',
		ghost:     'border border-border text-dim hover:border-accent hover:text-text',
	};

	const disabledClass = 'disabled:opacity-50 disabled:cursor-not-allowed';
	const widthClass = $derived(fullWidth ? 'block w-full text-center' : 'inline-flex items-center justify-center');

	const classes = $derived(
		`${base} ${variants[variant]} ${widthClass} ${disabledClass} ${className}`.trim()
	);
</script>

{#if href && !disabled}
	<a {href} class={classes}>
		{@render children()}
	</a>
{:else}
	<button type="button" {disabled} {onclick} class={classes}>
		{@render children()}
	</button>
{/if}
