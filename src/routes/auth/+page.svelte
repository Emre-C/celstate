<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { getAuthProviderDescriptors, type AuthProviderId } from '$lib/auth/providers';
	import { authClient } from '$lib/auth-client';
	import { resolveAuthClientBaseUrl } from '$lib/auth-client';
	import NavBar from '$lib/components/ui/NavBar.svelte';
	import PageContainer from '$lib/components/ui/PageContainer.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';

	const AUTH_ERROR_MESSAGES: Record<string, string> = {
		state_mismatch:
			'Your sign-in started on a different site origin than the callback. Please try again from the current page.',
		access_denied: 'Google sign-in was cancelled or denied.',
		default: 'Authentication failed. Please try again.'
	};

	const session = authClient.useSession();
	const providers = getAuthProviderDescriptors(resolveAuthClientBaseUrl());
	const appleProvider = providers.find((provider) => provider.id === 'apple');
	let errorMessage = $state('');
	let activeProvider = $state<AuthProviderId | null>(null);

	const redirectTo = $derived($page.url.searchParams.get('redirectTo') ?? '/app');
	const authenticated = $derived(!!$session.data);
	const authError = $derived($page.url.searchParams.get('error'));

	$effect(() => {
		if (!authenticated) {
			return;
		}

		void goto(redirectTo, { replaceState: true });
	});

	$effect(() => {
		if (activeProvider || !authError) {
			return;
		}

		errorMessage = AUTH_ERROR_MESSAGES[authError] ?? AUTH_ERROR_MESSAGES.default;
	});

	async function handleSocialAuth(providerId: AuthProviderId) {
		const provider = providers.find((candidate) => candidate.id === providerId);
		if (!provider || activeProvider) return;

		if (!provider.available) {
			errorMessage = provider.availabilityHint ?? 'This provider is not available in the current environment.';
			return;
		}

		activeProvider = providerId;
		errorMessage = '';

		try {
			const result = await authClient.signIn.social({
				provider: providerId,
				callbackURL: redirectTo
			});

			if (result.error) {
				errorMessage = result.error.message ?? 'Authentication failed.';
				activeProvider = null;
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Authentication failed.';
			activeProvider = null;
		}
	}
</script>

<svelte:head>
	<title>Sign in — Celstate</title>
</svelte:head>

<div class="min-h-dvh">
	<NavBar />

	<PageContainer max="4xl" class="py-28">
		<div class="mx-auto w-full max-w-md border border-border bg-bg">
			<div class="border-b border-border px-6 py-5">
				<SectionLabel text="Account" />
				<h1 class="mt-3 text-2xl font-light tracking-tight text-text">
					Trusted sign-in only
				</h1>
				<!-- TODO: Restore to "Google and Apple" once Apple Sign-In is re-enabled -->
				<p class="mt-2 text-sm text-dim">
					Celstate uses Google for identity. Apple Sign-In is coming soon. We do not support email/password accounts.
				</p>
			</div>

			<div class="space-y-5 px-6 py-6">
				<div class="space-y-3">
					{#each providers as provider}
						<button
							type="button"
							disabled={!provider.available || activeProvider !== null}
							onclick={() => handleSocialAuth(provider.id)}
							class="flex w-full items-center justify-between border border-border bg-bg px-4 py-3 text-left text-sm transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
						>
							<span class="flex items-center gap-3">
								<span class="flex h-9 w-9 items-center justify-center border border-border bg-bg text-text">
									{#if provider.id === 'google'}
										<svg class="h-4 w-4" viewBox="0 0 18 18" aria-hidden="true">
											<path fill="#EA4335" d="M9 7.364v3.491h4.852c-.213 1.122-.852 2.072-1.81 2.711l2.927 2.272c1.705-1.572 2.689-3.882 2.689-6.627 0-.639-.058-1.253-.164-1.847H9Z" />
											<path fill="#34A853" d="M9 18c2.43 0 4.469-.804 5.959-2.162l-2.927-2.272c-.804.541-1.834.86-3.032.86-2.331 0-4.311-1.573-5.018-3.691H.958v2.344A8.998 8.998 0 0 0 9 18Z" />
											<path fill="#4A90E2" d="M3.982 10.735a5.4 5.4 0 0 1-.279-1.735c0-.602.099-1.187.279-1.735V4.921H.958A8.998 8.998 0 0 0 0 9c0 1.445.344 2.811.958 4.079l3.024-2.344Z" />
											<path fill="#FBBC05" d="M9 3.574c1.326 0 2.513.456 3.449 1.35l2.581-2.581C13.465.885 11.426 0 9 0A8.998 8.998 0 0 0 .958 4.921l3.024 2.344C4.689 5.147 6.669 3.574 9 3.574Z" />
										</svg>
									{:else}
										<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
											<path d="M15.138 1.924c0 1.541-.561 2.951-1.49 3.95-.948 1.032-2.5 1.63-3.932 1.521-.179-1.505.542-3.063 1.471-4.008.949-.98 2.575-1.685 3.951-1.463Zm5.77 16.227c-.431.99-.641 1.432-1.197 2.264-.777 1.154-1.876 2.595-3.241 2.607-1.216.012-1.53-.8-3.18-.791-1.651.008-1.995.806-3.211.794-1.365-.012-2.406-1.309-3.183-2.463-2.171-3.216-2.4-6.992-1.059-8.998.952-1.425 2.455-2.263 3.867-2.263 1.438 0 2.345.8 3.535.8 1.154 0 1.857-.801 3.517-.801 1.257 0 2.588.684 3.538 1.864-3.111 1.706-2.607 6.173.614 6.987Z" />
										</svg>
									{/if}
								</span>
								<span>
									<span class="block font-medium text-text">{provider.label}</span>
									<span class="block text-xs text-dim">{provider.description}</span>
								</span>
							</span>
							<!-- TODO: Remove the `comingSoon` branch once Apple Sign-In is re-enabled -->
							<span class="text-xs uppercase tracking-[0.15em] text-dim">
								{#if provider.comingSoon}
									Coming soon
								{:else if activeProvider === provider.id}
									Redirecting
								{:else if provider.available}
									Continue
								{:else}
									HTTPS only
								{/if}
							</span>
						</button>
					{/each}
				</div>

				<!-- TODO: Restore original info box copy once Apple Sign-In is re-enabled -->
				<div class="border border-border bg-border/30 px-4 py-3">
					<p class="text-sm text-dim">
						Sign in with Google is available now. Apple Sign-In support is coming soon.
					</p>
				</div>

				{#if errorMessage}
					<div class="border border-red-900/40 bg-red-950/10 px-4 py-3">
						<p class="text-sm text-red-400/80">{errorMessage}</p>
					</div>
				{/if}
			</div>
		</div>
	</PageContainer>
</div>
