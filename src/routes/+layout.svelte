<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { captureSessionAttributionOnce } from '$lib/analytics/session-attribution';
	import { initPostHog, posthog } from '$lib/posthog';

	let { children } = $props();

	onMount(() => {
		if (!initPostHog()) {
			return;
		}

		captureSessionAttributionOnce({
			capture: (event, properties) => posthog.capture(event, properties),
			referrer: document.referrer,
			storage: window.sessionStorage,
			url: new URL(window.location.href)
		});
	});
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</svelte:head>

{@render children()}
