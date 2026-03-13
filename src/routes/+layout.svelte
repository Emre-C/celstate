<script lang="ts">
	import '../app.css';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';

	let { children, data } = $props();

	createSvelteAuthClient({
		authClient,
		getServerState: () => data.authState
	});
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<title>Celstate — Transparent Background Images</title>
</svelte:head>

{@render children()}
