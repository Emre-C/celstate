<script lang="ts">
	import '../app.css';
	import { setupConvex } from 'convex-svelte';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { setupConvexAuth } from '$lib/auth.svelte';

	let { children } = $props();
	setupConvex(PUBLIC_CONVEX_URL);
	const auth = setupConvexAuth();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<title>Celstate — Transparent Background Images</title>
</svelte:head>

{#if auth.isLoading}
	<div class="flex min-h-dvh items-center justify-center bg-bg">
		<span class="font-mono text-xs tracking-[0.15em] uppercase text-dim">Loading...</span>
	</div>
{:else}
	{@render children()}
{/if}
