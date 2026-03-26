<script lang="ts">
	import { goto } from '$app/navigation';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { createSvelteAuthClient, useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { authClient } from '$lib/auth-client';
	import {
		AUTH_SESSION_RECOVERY_GRACE_PERIOD_MS,
		getProtectedAppRedirectStrategy,
		getProtectedAppViewState
	} from '$lib/auth/protected-app.js';
	import { buildAuthRedirectTarget } from '$lib/auth/redirect.js';
	import { api } from '../../convex/_generated/api.js';

	let { children, data } = $props();

	createSvelteAuthClient({
		authClient,
		convexUrl: PUBLIC_CONVEX_URL,
		getServerState: () => data.authState
	});

	const auth = useAuth();
	const client = useConvexClient();

	let seededFromServer = $state(false);
	let hasAuthenticatedSession = $state(false);
	let redirectScheduled = $state(false);
	let startedUserSync = $state(false);
	let syncError = $state('');
	const viewState = $derived(
		getProtectedAppViewState({
			authIsAuthenticated: auth.isAuthenticated,
			authIsLoading: auth.isLoading,
			hasAuthenticatedSession,
			hasSyncError: !!syncError,
			redirectScheduled
		})
	);

	$effect(() => {
		if (seededFromServer || !data.authState?.isAuthenticated) {
			return;
		}

		seededFromServer = true;
		hasAuthenticatedSession = true;
	});

	$effect(() => {
		if (!auth.isAuthenticated) {
			return;
		}

		hasAuthenticatedSession = true;
		redirectScheduled = false;
	});

	$effect(() => {
		if (!auth.isAuthenticated || startedUserSync) {
			return;
		}

		startedUserSync = true;

		void client
			.mutation(api.users.storeUser, {})
			.then(() => {
				syncError = '';
			})
			.catch((error) => {
				syncError = error instanceof Error ? error.message : 'Unable to initialize your account.';
			});
	});

	$effect(() => {
		const redirectTarget = buildAuthRedirectTarget(window.location.pathname, window.location.search);
		const redirectStrategy = getProtectedAppRedirectStrategy({
			authIsAuthenticated: auth.isAuthenticated,
			authIsLoading: auth.isLoading,
			hasAuthenticatedSession
		});

		if (redirectStrategy === 'none') {
			redirectScheduled = false;
			return;
		}

		if (redirectStrategy === 'delayed') {
			const timeoutId = window.setTimeout(() => {
				hasAuthenticatedSession = false;
				redirectScheduled = true;
				void goto(redirectTarget, { replaceState: true });
			}, AUTH_SESSION_RECOVERY_GRACE_PERIOD_MS);

			return () => {
				window.clearTimeout(timeoutId);
			};
		}

		redirectScheduled = true;
		void goto(redirectTarget, { replaceState: true });
	});
</script>

{#if viewState.shouldShowLoading}
	<div class="flex min-h-dvh items-center justify-center">
		<span class="font-mono text-xs tracking-[0.15em] uppercase text-dim">Loading workspace...</span>
	</div>
{:else if viewState.shouldShowSyncError}
	<div class="flex min-h-dvh items-center justify-center px-6">
		<div class="w-full max-w-md border border-red-900/40 bg-red-950/10 px-6 py-5">
			<p class="text-sm text-red-400/80">{syncError}</p>
		</div>
	</div>
{:else if viewState.shouldRenderChildren}
	{@render children()}
{/if}
