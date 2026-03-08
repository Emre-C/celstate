<script lang="ts">
	import { setupConvex } from 'convex-svelte';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { setupConvexAuth } from '$lib/auth/auth.svelte';

	let { children } = $props();
	setupConvex(PUBLIC_CONVEX_URL);
	setupConvexAuth();
</script>

{@render children()}
