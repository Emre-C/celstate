<script lang="ts">
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

	const primaryProvider = $derived(data.providers.find((p) => p.available) ?? data.providers[0]);
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
				<h1 class="mt-3 text-2xl font-display italic tracking-tight text-text">
					Sign-in issue
				</h1>
				<p class="mt-2 text-sm text-dim">
					Something went wrong during authentication. Try again to continue to your workspace.
				</p>
			</div>

			<div class="space-y-5 px-6 py-6">
				<div class="border border-red-300 bg-red-50 px-4 py-3">
					<p class="text-sm text-red-700">{errorMessage}</p>
				</div>

				{#if primaryProvider}
					<a
						href={data.retryHref}
						data-testid="auth-sign-in"
						class="flex w-full items-center justify-center rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-accent/90"
					>
						Try again — {primaryProvider.label}
					</a>
				{/if}

				<div class="border border-border bg-bg px-4 py-3">
					<p class="text-sm text-dim">
						After you authenticate, you’ll return to
						<span class="font-medium text-text">{data.returnTo}</span>.
					</p>
				</div>
			</div>
		</div>
	</PageContainer>
</div>
