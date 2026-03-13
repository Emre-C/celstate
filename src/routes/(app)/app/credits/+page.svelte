<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { api } from '../../../../convex/_generated/api.js';
	import PageContainer from '$lib/components/ui/PageContainer.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';

	const client = useConvexClient();
	const user = useQuery(api.users.getMe, {});
	const priceIds = useQuery(api.users.getStripePriceIds, {});

	const credits = $derived(user.data?.credits ?? 0);

	let purchasing = $state<string | null>(null);
	let error = $state('');

	async function handlePurchase(priceId: string) {
		if (purchasing) return;
		purchasing = priceId;
		error = '';

		try {
			const result = await client.action(api.stripe.createPaymentCheckout, { priceId });
			if (result.url) {
				window.location.href = result.url;
			} else {
				error = 'Could not create checkout session. Please try again.';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
		} finally {
			purchasing = null;
		}
	}
</script>

<svelte:head>
	<title>Credits — Celstate</title>
</svelte:head>

<PageContainer max="4xl" class="py-8">
	<div class="mb-8">
		<SectionLabel text="Credits" />
		<h1 class="text-2xl font-light tracking-tight text-text">
			Get more credits
		</h1>
	</div>

	<!-- Current balance -->
	<div class="mb-10">
		<span class="font-mono text-xs tracking-[0.15em] uppercase {credits === 0 ? 'text-red-400' : 'text-dim'}">
			{credits} {credits === 1 ? 'credit' : 'credits'} remaining
		</span>
	</div>

	<!-- Error -->
	{#if error}
		<div class="mb-6 border border-red-900/40 bg-red-950/10 px-4 py-3">
			<div class="flex items-center gap-2">
				<svg class="h-4 w-4 shrink-0 text-red-500/60" viewBox="0 0 16 16" fill="none">
					<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2" />
					<path d="M8 4v5M8 11v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
				</svg>
				<p class="text-sm text-red-400/80">{error}</p>
			</div>
		</div>
	{/if}

	<!-- Pricing grid -->
	<div class="grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-2">
		<div class="flex flex-col bg-bg p-6 sm:p-8">
			<span class="mb-6 block font-mono text-[10px] tracking-[0.2em] uppercase text-accent">Starter</span>
			<span class="mb-2 block text-3xl font-light text-text">$5</span>
			<p class="mb-8 flex-1 text-sm leading-relaxed text-dim">
				15 credits, one-time. No subscription.
				Your free weekly drip continues on top.
			</p>
			<button
				onclick={() => priceIds.data && handlePurchase(priceIds.data.starter)}
				disabled={!!purchasing || !priceIds.data}
				class="w-full border border-accent bg-accent/10 py-2.5 text-center text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{purchasing === priceIds.data?.starter ? 'Redirecting…' : 'Buy Starter'}
			</button>
		</div>
		<div class="flex flex-col bg-bg p-6 sm:p-8">
			<div class="mb-6 flex items-center gap-3">
				<span class="font-mono text-[10px] tracking-[0.2em] uppercase text-accent">Pro</span>
				<span class="font-mono text-[10px] tracking-[0.15em] uppercase text-accent/60">Best value</span>
			</div>
			<span class="mb-2 block text-3xl font-light text-text">$10</span>
			<p class="mb-8 flex-1 text-sm leading-relaxed text-dim">
				40 credits at $0.25 each — 25% less than Starter.
				Same deal: one-time, no subscription, weekly drip continues.
			</p>
			<button
				onclick={() => priceIds.data && handlePurchase(priceIds.data.pro)}
				disabled={!!purchasing || !priceIds.data}
				class="w-full border border-accent bg-accent py-2.5 text-center text-sm font-medium text-bg transition-colors hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{purchasing === priceIds.data?.pro ? 'Redirecting…' : 'Buy Pro'}
			</button>
		</div>
	</div>

	<div class="mt-6 flex items-center justify-between">
		<p class="text-sm text-dim">
			Credits never expire. Secure checkout via Stripe.
		</p>
		<a href="/app" class="text-sm text-dim transition-colors hover:text-text">
			← Back
		</a>
	</div>
</PageContainer>
