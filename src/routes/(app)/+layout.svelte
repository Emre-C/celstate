<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { createSvelteAuthClient, useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { authClient } from '$lib/auth-client';
	import {
		beginUserSyncAttempt,
		createInitialUserSyncStatus,
		getProtectedSessionRedirectPlan,
		getProtectedSessionViewState,
		getUserSyncErrorMessage,
		hasUserSyncError,
		isUserSyncInFlight,
		markUserSyncFailure,
		markUserSyncSuccess,
		shouldAutoRetryUserSync,
		type UserSyncStatus
	} from '$lib/auth/protected-session.js';
	import { api } from '../../convex/_generated/api.js';

	let { children, data } = $props();

	createSvelteAuthClient({
		authClient,
		convexUrl: PUBLIC_CONVEX_URL,
		getServerState: () => data.protectedSession
	});

	const auth = useAuth();
	const client = useConvexClient();

	let hasAuthenticatedSession = $state(false);
	let redirectScheduled = $state(false);
	let userSyncStatus = $state<UserSyncStatus>(createInitialUserSyncStatus());
	const viewState = $derived(
		getProtectedSessionViewState({
			authIsAuthenticated: auth.isAuthenticated,
			authIsLoading: auth.isLoading,
			hasAuthenticatedSession,
			hasSyncError: hasUserSyncError(userSyncStatus),
			redirectScheduled
		})
	);
	const redirectPlan = $derived(
		getProtectedSessionRedirectPlan({
			pathname: $page.url.pathname,
			search: $page.url.search,
			authIsAuthenticated: auth.isAuthenticated,
			authIsLoading: auth.isLoading,
			hasAuthenticatedSession
		})
	);

	const runUserSync = async () => {
		// Snapshot the previous status synchronously so the running transition
		// records the correct attempt counter even under rapid re-entry.
		const previous = userSyncStatus;
		userSyncStatus = beginUserSyncAttempt(previous);
		try {
			await client.mutation(api.users.storeUser, {});
			userSyncStatus = markUserSyncSuccess(userSyncStatus);
		} catch (error) {
			userSyncStatus = markUserSyncFailure({ prev: userSyncStatus, error });
		}
	};

	const triggerManualUserSyncRetry = () => {
		// Manual retry is only meaningful from the error state; gate to avoid
		// cancelling a flight already in progress or re-running after success.
		if (userSyncStatus.kind !== 'error') {
			return;
		}
		void runUserSync();
	};

	$effect(() => {
		if (!data.protectedSession.isAuthenticated) {
			return;
		}

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
		if (!auth.isAuthenticated) {
			return;
		}
		if (userSyncStatus.kind !== 'idle') {
			return;
		}

		void runUserSync();
	});

	$effect(() => {
		// Bounded auto-retry: schedule the next attempt with the policy-supplied
		// backoff. The cleanup clears the pending timeout whenever the status
		// transitions out of the retry window (success, manual retry, sign-out).
		if (!auth.isAuthenticated) {
			return;
		}
		if (userSyncStatus.kind !== 'error' || userSyncStatus.autoRetryDelayMs === null) {
			return;
		}
		const delay = userSyncStatus.autoRetryDelayMs;
		const timeoutId = window.setTimeout(() => {
			void runUserSync();
		}, delay);
		return () => {
			window.clearTimeout(timeoutId);
		};
	});

	$effect(() => {
		if (redirectPlan.kind === 'none') {
			redirectScheduled = false;
			return;
		}

		if (redirectPlan.kind === 'delayed') {
			const timeoutId = window.setTimeout(() => {
				hasAuthenticatedSession = false;
				redirectScheduled = true;
				void goto(redirectPlan.location, { replaceState: true });
			}, redirectPlan.delayMs);

			return () => {
				window.clearTimeout(timeoutId);
			};
		}

		redirectScheduled = true;
		void goto(redirectPlan.location, { replaceState: true });
	});
</script>

{#if viewState.shouldShowLoading}
	<div class="flex min-h-dvh items-center justify-center">
		<span class="text-xs font-medium tracking-[0.08em] uppercase text-dim">Loading workspace...</span>
	</div>
{:else if viewState.shouldShowSyncError}
	<div class="flex min-h-dvh items-center justify-center px-6">
		<div class="w-full max-w-md space-y-4 border border-red-300 bg-red-50 px-6 py-5">
			<p class="text-sm text-red-700">{getUserSyncErrorMessage(userSyncStatus)}</p>
			{#if shouldAutoRetryUserSync(userSyncStatus)}
				<p class="text-[10px] font-medium tracking-[0.06em] uppercase text-dim">
					Retrying automatically…
				</p>
			{:else}
				<button
					type="button"
					class="text-[10px] font-medium tracking-[0.06em] uppercase text-red-700 underline-offset-4 hover:underline disabled:opacity-50"
					disabled={isUserSyncInFlight(userSyncStatus)}
					onclick={triggerManualUserSyncRetry}
				>
					Try again
				</button>
			{/if}
		</div>
	</div>
{:else if viewState.shouldRenderChildren}
	{@render children()}
{/if}
