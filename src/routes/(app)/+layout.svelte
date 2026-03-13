<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useConvexClient } from '@mmailaender/convex-svelte';

	let { children } = $props();
	const auth = useAuth();
	const client = useConvexClient();

	let userReady = $state(false);
	let startedUserSync = $state(false);
	let syncError = $state('');

	$effect(() => {
		if (auth.isLoading || auth.isAuthenticated) {
			return;
		}

		const redirectTo = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
		void goto(`/auth?redirectTo=${redirectTo}`, { replaceState: true });
	});

	$effect(() => {
		if (!auth.isAuthenticated || startedUserSync) {
			return;
		}

		startedUserSync = true;

		void client
			.mutation(api.users.storeUser, {})
			.then(() => {
				userReady = true;
			})
			.catch((error) => {
				syncError = error instanceof Error ? error.message : 'Unable to initialize your account.';
			});
	});
</script>

{#if auth.isLoading || (auth.isAuthenticated && !userReady && !syncError)}
	<div class="flex min-h-dvh items-center justify-center">
		<span class="font-mono text-xs tracking-[0.15em] uppercase text-dim">Loading workspace...</span>
	</div>
{:else if syncError}
	<div class="flex min-h-dvh items-center justify-center px-6">
		<div class="w-full max-w-md border border-red-900/40 bg-red-950/10 px-6 py-5">
			<p class="text-sm text-red-400/80">{syncError}</p>
		</div>
	</div>
{:else if auth.isAuthenticated}
	{@render children()}
{/if}
