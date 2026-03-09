<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { useConvexAuth } from '$lib/auth/auth.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import NavBar from '$lib/components/ui/NavBar.svelte';

	let { children } = $props();
	const auth = useConvexAuth();
	const user = useQuery(api.users.getMe, () => (auth.isAuthenticated ? {} : 'skip'));
</script>

{#if auth.isLoading}
	<div class="flex min-h-dvh items-center justify-center">
		<span class="font-mono text-xs tracking-[0.15em] uppercase text-dim">Loading...</span>
	</div>
{:else if !auth.isAuthenticated}
	<div class="flex min-h-dvh flex-col items-center justify-center gap-6">
		<div class="flex items-center gap-2.5">
			<Logo class="h-6 w-6" />
			<span class="text-lg font-light tracking-tight text-text">celstate</span>
		</div>
		<p class="text-sm text-dim">Sign in to start generating transparent images.</p>
		<button
			onclick={() => auth.signIn('google')}
			class="flex items-center gap-2 border border-border px-5 py-2.5 text-sm text-text transition-colors hover:border-accent hover:text-accent"
		>
			<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
				<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
				<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
				<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
				<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
			</svg>
			Sign in with Google
		</button>
	</div>
{:else}
	<div class="min-h-dvh">
		<NavBar compact>
			<div class="flex items-center gap-5">
				{#if user.data}
					<div class="flex items-center gap-2">
						<span class="h-1.5 w-1.5 rounded-full bg-accent"></span>
						<span class="font-mono text-xs tracking-[0.15em] uppercase text-dim">
							{user.data.credits ?? 0} credits
						</span>
					</div>
				{/if}
				<button
					onclick={() => auth.signOut()}
					class="text-sm text-dim transition-colors hover:text-text"
				>Sign Out</button>
			</div>
		</NavBar>

		<main class="pt-14">
			{@render children()}
		</main>
	</div>
{/if}
