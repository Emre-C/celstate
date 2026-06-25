<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { ConvexError } from 'convex/values';
	import { buildGenerationFailedAnalyticsProps } from '$lib/analytics/generation';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import PromptInput from '$lib/components/PromptInput.svelte';
	import GenerationCard from '$lib/components/GenerationCard.svelte';
	import PageContainer from '$lib/components/ui/PageContainer.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { growthEvents } from '$lib/analytics/growth-events.js';
	import { initPostHog, posthog } from '$lib/analytics/client-posthog';

	const client = useConvexClient();
	const user = useQuery(api.users.getMe, {});
	const generations = useQuery(api.generations.getByUserWithUrls, {});

	let errorMessage = $state('');
	let successMessage = $state('');
	let creditNudge = $state(false);
	let creditNudgeTimer: ReturnType<typeof setTimeout> | undefined;
	let purchaseSuccessCaptured = $state(false);

	/** Avoids reactive feedback loops when syncing Convex subscription → PostHog. */
	const generationStatusPrev = new Map<string, 'generating' | 'complete' | 'failed'>();

	$effect(() => {
		const params = $page.url.searchParams;
		if (params.get('success') === 'true') {
			if (browser && !purchaseSuccessCaptured) {
				purchaseSuccessCaptured = true;
				initPostHog();
				posthog.capture('credits_checkout_returned');
			}
			successMessage = 'Payment successful! Your credits are being added.';
			goto('/app', { replaceState: true });
		} else if (params.get('canceled') === 'true') {
			errorMessage = 'Payment canceled. No charges were made.';
			goto('/app', { replaceState: true });
		}
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		const list = generations.data;
		if (!list) {
			return;
		}

		for (const g of list) {
			const id = String(g._id);
			const analyticsGeneration = g as typeof g & {
				failureKind?: string;
				failureStage?: string;
			};
			const prev = generationStatusPrev.get(id);
			if (prev === 'generating' && g.status === 'complete') {
				initPostHog();
				posthog.capture('generation_completed', {
					aspect_ratio: g.aspectRatio,
					generation_id: id,
					generation_time_ms: g.generationTimeMs,
				});
			} else if (prev === 'generating' && g.status === 'failed') {
				initPostHog();
				posthog.capture(
					'generation_failed',
					buildGenerationFailedAnalyticsProps({
						error: g.error,
						failureKind: analyticsGeneration.failureKind,
						failureStage: analyticsGeneration.failureStage,
						generationId: id,
						retryCount: g.retryCount,
						stage: g.stage,
						statusMessage: g.statusMessage
					})
				);
			}
			generationStatusPrev.set(id, g.status);
		}
	});

	const activeGeneration = $derived(
		generations.data?.find((g) => g.status === 'generating')
	);
	const generating = $derived(!!activeGeneration);

	const completedCount = $derived(
		generations.data?.filter((g) => g.status === 'complete').length ?? 0
	);
	let prevCompletedCount = $state(0);

	$effect(() => {
		if (completedCount > prevCompletedCount && prevCompletedCount > 0) {
			if (credits !== undefined && credits <= 2) {
				creditNudge = true;
				clearTimeout(creditNudgeTimer);
				creditNudgeTimer = setTimeout(() => (creditNudge = false), 8000);
			}
		}
		prevCompletedCount = completedCount;
	});

	async function handleGenerate(prompt: string, referenceStorageIds?: string[], aspectRatio?: string) {
		if (generating) return;
		errorMessage = '';

		try {
			await client.mutation(api.generations.requestGeneration, {
				prompt,
				referenceStorageIds: referenceStorageIds as Id<'_storage'>[] | undefined,
				aspectRatio,
			});
			initPostHog();
			posthog.capture('generation_started', {
				aspect_ratio: aspectRatio ?? '1:1',
				reference_count: referenceStorageIds?.length ?? 0,
			});
		} catch (e) {
			if (e instanceof ConvexError) {
				errorMessage = String(e.data);
			} else {
				errorMessage = e instanceof Error ? e.message : 'Generation failed. Please try again.';
			}
		}
	}

	const credits = $derived(user.data?.credits);
	const hasGenerations = $derived(
		!generations.isLoading && generations.data && generations.data.length > 0
	);
</script>

<svelte:head>
	<title>Generate — Celstate</title>
</svelte:head>

<PageContainer max="4xl" class="min-w-0 py-6 sm:py-8">
		<div class="mb-8 min-w-0">
			<SectionLabel text="Generation workspace" />
			<h1
				class="font-display text-2xl font-light tracking-tight text-balance text-text italic"
			>
				What do you need?
			</h1>
		</div>

		<div class="mb-10">
			<PromptInput
				onsubmit={handleGenerate}
				disabled={generating}
				{credits}
			/>
		</div>

		{#if creditNudge}
			<div
				class="mb-6 flex flex-wrap items-start gap-2 px-1 sm:flex-nowrap sm:items-center sm:justify-between sm:gap-3"
			>
				<span
					class="min-w-0 flex-1 break-words text-[10px] font-medium tracking-[0.06em] text-dim uppercase"
				>
					Image ready · <span class="tabular-nums">{credits}</span>
					{credits === 1 ? 'credit' : 'credits'} left ·
					<a
						href="/app/credits"
						class="text-accent transition-colors hover:text-text"
						onclick={() => {
							initPostHog();
							posthog.capture(growthEvents.creditsPurchaseCtaClicked, {
								surface: 'post_generation_banner'
							});
						}}>Get more →</a>
				</span>
				<button
					type="button"
					onclick={() => (creditNudge = false)}
					aria-label="Dismiss"
					class="shrink-0 text-dim/40 transition-colors hover:text-dim"
				>
					<svg class="h-3 w-3" viewBox="0 0 12 12" fill="none">
						<path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
					</svg>
				</button>
			</div>
		{/if}

		{#if successMessage}
			<div class="mb-6 border border-green-300 bg-green-50 px-4 py-3">
				<div class="flex items-start gap-3 sm:items-center sm:justify-between">
					<p class="min-w-0 flex-1 break-words text-sm text-green-700">{successMessage}</p>
					<button
						type="button"
						onclick={() => (successMessage = '')}
						aria-label="Dismiss"
						class="shrink-0 text-dim transition-colors hover:text-text"
					>
						<svg class="h-4 w-4" viewBox="0 0 16 16" fill="none">
							<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
						</svg>
					</button>
				</div>
			</div>
		{/if}

		{#if errorMessage}
			<div class="mb-6 border border-red-300 bg-red-50 px-4 py-3">
				<div class="flex items-start gap-2">
					<svg class="mt-0.5 h-4 w-4 shrink-0 text-red-600" viewBox="0 0 16 16" fill="none">
						<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2" />
						<path d="M8 4v5M8 11v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
					</svg>
					<p class="min-w-0 flex-1 break-words text-sm text-red-700">{errorMessage}</p>
				</div>
			</div>
		{/if}

		{#if generations.isLoading}
			<div class="flex items-center justify-center py-16">
				<span class="text-xs font-medium uppercase tracking-[0.06em] text-dim">Loading history...</span>
			</div>
		{:else if hasGenerations}
			<div class="mb-6">
				<SectionLabel text="Your generations" />
			</div>

			<div
				class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0"
			>
				{#each generations.data! as gen (gen._id)}
					<GenerationCard
						generationId={gen._id}
						prompt={gen.prompt}
						status={gen.status}
						statusMessage={gen.statusMessage}
						resultUrl={gen.resultUrl ?? undefined}
						optimizedUrl={gen.optimizedUrl ?? undefined}
						referenceUrls={gen.referenceUrls}
						error={gen.error}
						createdAt={gen.createdAt}
						completedAt={gen.completedAt}
						generationTimeMs={gen.generationTimeMs}
						aspectRatio={gen.aspectRatio}
					/>
				{/each}
			</div>
		{:else}
			<div class="flex flex-col items-center justify-center px-2 py-16 sm:py-20">
				<div class="empty-state-grid mb-6" aria-hidden="true">
					{#each Array(16) as _, i}
						<div class="empty-cell" style="animation-delay: {i * 150}ms"></div>
					{/each}
				</div>
				<p class="mb-1 max-w-md text-center text-sm text-dim">No generations yet</p>
				<p class="max-w-md text-pretty text-center text-xs text-dim/60">
					Type a prompt above to generate your first transparent image.
				</p>
			</div>
		{/if}
</PageContainer>

<style>
	.empty-state-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 3px;
		width: 52px;
	}

	.empty-cell {
		width: 10px;
		height: 10px;
		background-color: var(--color-border);
		animation: empty-breathe 3s ease-in-out infinite;
	}

	@keyframes empty-breathe {
		0%, 100% {
			opacity: 0.3;
		}
		50% {
			opacity: 0.6;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.empty-cell {
			animation: none;
			opacity: 0.45;
		}
	}
</style>
