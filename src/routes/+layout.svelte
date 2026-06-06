<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { ClerkProvider } from 'svelte-clerk';
	import { captureSessionAttributionOnce } from '$lib/analytics/session-attribution';
	import { initPostHog, posthog } from '$lib/analytics/client-posthog';

	let { children, data } = $props();

	const clerkAppearance = {
		variables: {
			colorBackground: '#F5F3ED',
			colorText: '#1C1917',
			colorPrimary: '#C2410C',
			colorNeutral: '#78716C',
			fontFamily: '"DM Sans", ui-sans-serif, system-ui, sans-serif',
			fontFamilyButtons: '"DM Sans", ui-sans-serif, system-ui, sans-serif'
		},
		elements: {
			// Structural blending for <SignIn> lives in src/routes/auth/+page.svelte
			// (component-scoped appearance). Keep global overrides to brand-safe
			// defaults that apply cleanly across any Clerk component.
			formButtonPrimary: 'rounded-full bg-accent text-white hover:bg-accent/90',
			headerTitle: 'font-display italic text-text',
			headerSubtitle: 'text-dim',
			footerActionLink: 'text-accent'
		}
	};

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

<ClerkProvider
	appearance={clerkAppearance}
	afterSignOutUrl="/"
	signInUrl="/auth"
	signUpUrl="/auth"
	signInFallbackRedirectUrl="/app"
	signUpFallbackRedirectUrl="/app"
>
	{@render children()}
</ClerkProvider>
