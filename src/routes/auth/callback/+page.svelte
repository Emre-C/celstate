<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ConvexHttpClient } from 'convex/browser';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import {
		consumeVerifier,
		consumeReturnPath,
		writeTokens,
		clearTokens,
	} from '$lib/auth/storage';

	let error = $state('');

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const code = params.get('code');

		if (!code) {
			error = 'No authorization code found.';
			setTimeout(() => goto('/'), 2000);
			return;
		}

		try {
			const verifier = consumeVerifier();
			const httpClient = new ConvexHttpClient(PUBLIC_CONVEX_URL);
			const result = await httpClient.action('auth:signIn' as any, {
				params: { code },
				verifier,
			});

			if (result?.tokens) {
				writeTokens(result.tokens.token, result.tokens.refreshToken);
				const returnPath = consumeReturnPath();
				await goto(returnPath && returnPath !== '/auth/callback' ? returnPath : '/app');
			} else {
				clearTokens();
				error = 'Authentication failed. Redirecting...';
				setTimeout(() => goto('/'), 2000);
			}
		} catch {
			clearTokens();
			error = 'Authentication failed. Redirecting...';
			setTimeout(() => goto('/'), 2000);
		}
	});
</script>

<div class="flex min-h-dvh items-center justify-center bg-bg">
	{#if error}
		<span class="font-mono text-xs tracking-[0.15em] uppercase text-red-400/80">{error}</span>
	{:else}
		<span class="font-mono text-xs tracking-[0.15em] uppercase text-dim">Signing you in…</span>
	{/if}
</div>
