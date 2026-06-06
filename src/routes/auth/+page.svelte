<script lang="ts">
	import { SignIn } from 'svelte-clerk';
	import NavBar from '$lib/components/ui/NavBar.svelte';
	import PageContainer from '$lib/components/ui/PageContainer.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const AUTH_ERROR_MESSAGES: Record<string, string> = {
		state_mismatch:
			'Your sign-in started on a different site origin than the callback. Please try again from the current page.',
		access_denied: 'Sign-in was cancelled or denied.',
		default: 'Authentication failed. Please try again.'
	};

	const errorMessage = $derived(
		AUTH_ERROR_MESSAGES[data.authError] ?? AUTH_ERROR_MESSAGES.default
	);

	// Clerk's official "flush" elevation (May 2026) removes card background,
	// border, and shadow so the widget embeds into the page surface. We then
	// style internal elements to match the Celstate design system.
	// Docs: https://clerk.com/changelog/2026-05-22-flush-appearance-option
	const signInAppearance = {
		options: {
			elevation: 'flush'
		},
		elements: {
			headerTitle: { display: 'none' },
			headerSubtitle: { display: 'none' },
			footerAction: { display: 'none' },
			socialButtonsBlockButton:
				'rounded-full border border-border bg-bg py-2.5 text-text normal-case shadow-none transition-colors hover:border-accent hover:text-accent',
			socialButtonsBlockButtonText: 'text-sm font-medium',
			dividerLine: 'bg-border',
			dividerText: 'text-dim text-[11px] uppercase tracking-[0.08em]',
			formFieldLabel: 'text-text text-sm font-medium',
			formFieldInput:
				'rounded-none border border-border bg-bg text-text focus:border-accent focus:ring-0',
			formButtonPrimary:
				'rounded-full bg-accent text-white normal-case shadow-none hover:bg-accent/90',
			footerActionLink: 'text-accent hover:text-accent/80'
		}
	};

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
				{#if data.authError}
					<h1 class="mt-3 text-2xl font-display italic tracking-tight text-text">
						Sign-in issue
					</h1>
					<p class="mt-2 text-sm text-dim">
						Something went wrong during authentication. Try again to continue to your workspace.
					</p>
				{:else}
					<h1 class="mt-3 text-2xl font-display italic tracking-tight text-text">
						Welcome back
					</h1>
					<p class="mt-2 text-sm text-dim">
						Sign in to generate transparent-background images and manage your workspace.
					</p>
				{/if}
			</div>

			<div class="space-y-5 px-6 py-6">
				{#if data.authError}
					<div class="border border-red-300 bg-red-50 px-4 py-3">
						<p class="text-sm text-red-700">{errorMessage}</p>
					</div>
				{/if}

				<div data-testid="auth-sign-in">
					<SignIn
						routing="hash"
						forceRedirectUrl={data.returnTo}
						signUpForceRedirectUrl={data.returnTo}
						appearance={signInAppearance}
					/>
				</div>

				<p class="text-xs text-dim">
					After you authenticate, you’ll return to
					<span class="font-medium text-text">{data.returnTo}</span>.
				</p>
			</div>
		</div>
	</PageContainer>
</div>
