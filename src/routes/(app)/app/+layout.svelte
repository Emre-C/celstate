<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { api } from '../../../convex/_generated/api.js';
	import NavBar from '$lib/components/ui/NavBar.svelte';

	let { children } = $props();
	const user = useQuery(api.users.getMe, {});
	const credits = $derived(user.data?.credits ?? 0);
	let signingOut = $state(false);

	async function handleSignOut() {
		if (signingOut) return;
		signingOut = true;
		await authClient.signOut();
		await goto('/', { replaceState: true });
		signingOut = false;
	}
</script>

<div class="min-h-dvh">
	<NavBar compact>
		<div class="flex items-center gap-4">
			<a href="/app/credits" class="flex items-center gap-2 transition-colors hover:text-accent">
				<span class="h-1.5 w-1.5 rounded-full bg-accent"></span>
				<span class="font-mono text-xs tracking-[0.15em] uppercase text-dim">
					{credits} {credits === 1 ? 'credit' : 'credits'}
				</span>
			</a>
			<button
				type="button"
				onclick={handleSignOut}
				disabled={signingOut}
				class="font-mono text-xs tracking-[0.15em] uppercase text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
			>
				{signingOut ? 'Signing out…' : 'Sign out'}
			</button>
		</div>
	</NavBar>

	<main class="pt-14">
		{@render children()}
	</main>
</div>
