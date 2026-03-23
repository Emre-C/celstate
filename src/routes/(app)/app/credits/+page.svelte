<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { api } from '../../../../convex/_generated/api.js';
	import type { Id } from '../../../../convex/_generated/dataModel.js';
	import PageContainer from '$lib/components/ui/PageContainer.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { initPostHog, posthog } from '$lib/posthog';

	const client = useConvexClient();
	const user = useQuery(api.users.getMe, {});
	const priceIds = useQuery(api.users.getStripePriceIds, {});

	const credits = $derived(user.data?.credits ?? 0);

	let purchasing = $state<string | null>(null);
	let error = $state('');
	let pendingCheckoutId = $state<Id<'pendingCheckouts'> | null>(null);

	const checkoutStatus = useQuery(
		api.pendingCheckouts.getCheckoutStatus,
		() => (pendingCheckoutId ? { checkoutId: pendingCheckoutId } : 'skip')
	);

	$effect(() => {
		const status = checkoutStatus.data;
		if (!status || !pendingCheckoutId) return;

		if (status.status === 'ready') {
			if (status.checkoutUrl) {
				window.location.href = status.checkoutUrl;
			} else {
				error = 'Could not create checkout session. Please try again.';
				purchasing = null;
				pendingCheckoutId = null;
			}
		} else if (status.status === 'failed') {
			error = status.error;
			purchasing = null;
			pendingCheckoutId = null;
		}
	});

	async function handlePurchase(priceId: string) {
		if (purchasing) return;
		purchasing = priceId;
		error = '';

		try {
			pendingCheckoutId = await client.mutation(
				api.pendingCheckouts.requestCheckout,
				{ priceId }
			);
			initPostHog();
			posthog.capture('credits_purchase_initiated', { price_id: priceId });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
			purchasing = null;
			pendingCheckoutId = null;
		}
	}
</script>

<svelte:head>
	<title>Credits — Celstate</title>
</svelte:head>

<PageContainer max="4xl" class="py-8">
	<div class="mb-8">
		<SectionLabel text="Credits" />
		<h1 class="font-display italic text-2xl font-light tracking-tight text-text">
			Get more credits
		</h1>
	</div>

	<!-- Current balance -->
	<div class="mb-10">
		<span class="text-xs font-medium uppercase tracking-[0.06em] {credits === 0 ? 'text-red-400' : 'text-dim'}">
			{credits} {credits === 1 ? 'credit' : 'credits'} remaining
		</span>
	</div>

	<!-- Error -->
	{#if error}
		<div class="mb-6 border border-red-300 bg-red-50 px-4 py-3">
			<div class="flex items-center gap-2">
				<svg class="h-4 w-4 shrink-0 text-red-600" viewBox="0 0 16 16" fill="none">
					<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2" />
					<path d="M8 4v5M8 11v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
				</svg>
				<p class="text-sm text-red-700">{error}</p>
			</div>
		</div>
	{/if}

	<!-- Pricing grid -->
	<div class="grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-2">
		<div class="flex flex-col bg-bg p-6 sm:p-8">
			<span class="mb-6 block text-[11px] font-medium uppercase tracking-[0.08em] text-accent">Starter</span>
			<span class="mb-2 block font-display italic text-3xl text-text">$5</span>
			<p class="mb-8 flex-1 text-sm leading-relaxed text-dim">
				15 credits, one-time. No subscription.
				You'll always get 1 free credit each Monday if you're at zero.
			</p>
			<button
				onclick={() => priceIds.data && handlePurchase(priceIds.data.starter)}
				disabled={!!purchasing || !priceIds.data}
				class="w-full border border-accent bg-accent/10 py-2.5 text-center text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{purchasing === priceIds.data?.starter ? 'Redirecting…' : 'Buy Starter'}
			</button>
		</div>
		<div class="flex flex-col bg-bg p-6 sm:p-8">
			<div class="mb-6 flex items-center gap-3">
				<span class="text-[11px] font-medium uppercase tracking-[0.08em] text-accent">Pro</span>
				<span class="text-[11px] font-medium uppercase tracking-[0.08em] text-accent/60">Best value</span>
			</div>
			<span class="mb-2 block font-display italic text-3xl text-text">$10</span>
			<p class="mb-8 flex-1 text-sm leading-relaxed text-dim">
				40 credits at $0.25 each — 25% less than Starter.
				One-time, no subscription. Free weekly credit replenishes when you hit zero.
			</p>
			<button
				onclick={() => priceIds.data && handlePurchase(priceIds.data.pro)}
				disabled={!!purchasing || !priceIds.data}
				class="w-full border border-accent bg-accent py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
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
