<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { growthEvents } from '$lib/analytics/growth-events.js';
	import { initPostHog, posthog } from '$lib/analytics/client-posthog';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useClerkContext } from 'svelte-clerk';
	import { api } from '../../../convex/_generated/api.js';
	import NavBar from '$lib/components/ui/NavBar.svelte';
	import ApiKeyDialog from '$lib/components/ApiKeyDialog.svelte';

	let { children } = $props();
	const user = useQuery(api.users.getMe, {});
	const clerk = useClerkContext();
	const credits = $derived(user.data?.credits ?? 0);
	const creditColor = $derived(
		credits === 0 ? 'text-red-700' : credits <= 2 ? 'text-accent' : 'text-dim'
	);
	const activePath = $derived($page.url.pathname);
	let signingOut = $state(false);
	let apiKeyDialogOpen = $state(false);

	$effect(() => {
		if (!browser) {
			return;
		}
		initPostHog();
		const doc = user.data;
		if (doc) {
			posthog.identify(String(doc._id), {
				credits: doc.credits,
				email: doc.email,
				name: doc.name,
			});
		}
	});

	async function handleSignOut() {
		if (signingOut) {
			return;
		}
		signingOut = true;
		initPostHog();
		posthog.reset();
		await clerk.clerk?.signOut({ redirectUrl: '/' });
	}
</script>

<div class="min-h-dvh">
	<NavBar compact max="4xl">
		<div class="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 sm:gap-x-4">
			<nav class="flex min-w-0 items-center gap-1" aria-label="Workspace">
				<a
					href="/app"
					aria-current={activePath === '/app' ? 'page' : undefined}
					class="rounded-full border px-3 py-1.5 text-[10px] font-medium tracking-[0.06em] uppercase transition-colors {activePath === '/app' ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border text-dim hover:border-accent hover:text-text'}"
				>
					Images
				</a>
				<a
					href="/app/animations"
					aria-current={activePath === '/app/animations' ? 'page' : undefined}
					class="rounded-full border px-3 py-1.5 text-[10px] font-medium tracking-[0.06em] uppercase transition-colors {activePath === '/app/animations' ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border text-dim hover:border-accent hover:text-text'}"
				>
					Motion
				</a>
			</nav>
			<button
				type="button"
				onclick={() => (apiKeyDialogOpen = true)}
				class="rounded-full border border-border px-3 py-1.5 text-[10px] font-medium tracking-[0.06em] text-dim uppercase transition-colors hover:border-accent hover:text-text"
			>
				API Access
			</button>
			<a
				href="/app/credits"
				class="flex min-w-0 items-center gap-1.5 transition-colors hover:text-accent"
				onclick={() => {
					if (!browser || credits !== 0) {
						return;
					}
					initPostHog();
					posthog.capture(growthEvents.creditsPurchaseCtaClicked, { surface: 'navbar' });
				}}
			>
				<span class="text-xs font-medium tracking-[0.06em] uppercase {creditColor}">
					<span class="tabular-nums">{credits}</span>
					{credits === 1 ? 'credit' : 'credits'}
				</span>
			</a>
			<button
				type="button"
				data-testid="workspace-sign-out"
				onclick={handleSignOut}
				disabled={signingOut}
				class="shrink-0 text-xs font-medium tracking-[0.06em] text-dim uppercase transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
			>
				{signingOut ? 'Signing out…' : 'Sign out'}
			</button>
		</div>
	</NavBar>

	<main class="min-w-0 pt-14">
		{@render children()}
	</main>
</div>

<ApiKeyDialog bind:open={apiKeyDialogOpen} />
