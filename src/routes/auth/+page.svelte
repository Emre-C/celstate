<script lang="ts">
	import { page } from '$app/stores';
	import NavBar from '$lib/components/ui/NavBar.svelte';
	import PageContainer from '$lib/components/ui/PageContainer.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';

	const AUTH_ERROR_MESSAGES: Record<string, string> = {
		state_mismatch:
			'Your sign-in started on a different site origin than the callback. Please try again from the current page.',
		access_denied: 'Sign-in was cancelled or denied.',
		default: 'Authentication failed. Please try again.'
	};

	const redirectTo = $derived($page.url.searchParams.get('redirectTo') ?? '/app');
	const authError = $derived($page.url.searchParams.get('error'));

	const signInHref = $derived(() => {
		const target =
			redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/app';
		return `/sign-in?returnTo=${encodeURIComponent(target)}`;
	});

	const errorMessage = $derived(
		authError ? (AUTH_ERROR_MESSAGES[authError] ?? AUTH_ERROR_MESSAGES.default) : ''
	);
</script>

<svelte:head>
	<title>Sign in — Celstate</title>
</svelte:head>

<div class="min-h-dvh" data-testid="auth-page">
	<NavBar />

	<PageContainer max="4xl" class="py-28">
		<div class="mx-auto w-full max-w-md border border-border bg-bg">
			<div class="border-b border-border px-6 py-5">
				<SectionLabel text="Account" />
				<h1 class="mt-3 text-2xl font-display italic tracking-tight text-text">Trusted sign-in</h1>
				<p class="mt-2 text-sm text-dim">
					Celstate uses WorkOS AuthKit with trusted identity providers (Google and more). We do not offer
					email/password accounts on our servers.
				</p>
			</div>

			<div class="space-y-5 px-6 py-6">
				<a
					href={signInHref()}
					data-testid="auth-workos-sign-in"
					class="flex w-full items-center justify-between border border-border bg-bg px-4 py-3 text-left text-sm transition-colors hover:border-accent hover:text-accent"
				>
					<span class="flex flex-col gap-0.5">
						<span class="font-medium text-text">Continue</span>
						<span class="text-xs text-dim">Secure sign-in via WorkOS AuthKit</span>
					</span>
					<span class="text-xs font-medium uppercase tracking-[0.06em] text-dim">Go</span>
				</a>

				<div class="border border-border bg-bg px-4 py-3">
					<p class="text-sm text-dim">
						You’ll finish signing in on WorkOS, then return to Celstate at your requested workspace route.
					</p>
				</div>

				{#if errorMessage}
					<div class="border border-red-300 bg-red-50 px-4 py-3">
						<p class="text-sm text-red-700">{errorMessage}</p>
					</div>
				{/if}
			</div>
		</div>
	</PageContainer>
</div>
