<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<title>Celstate — Transparent Background Images</title>
</svelte:head>

{@render children()}
