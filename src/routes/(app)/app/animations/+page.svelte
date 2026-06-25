<script lang="ts">
	import { browser } from '$app/environment';
	import { getErrorMessage } from '$lib/utils/errors.js';
	import { ConvexError } from 'convex/values';
	import { useConvexClient, useQuery } from '@mmailaender/convex-svelte';
	import { api } from '../../../../convex/_generated/api.js';
	import LottieGenerationCard from '$lib/components/LottieGenerationCard.svelte';
	import PageContainer from '$lib/components/ui/PageContainer.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { initPostHog, posthog } from '$lib/analytics/client-posthog';

	type AspectRatio = '1:1' | '4:3' | '16:9' | '9:16';
	type DurationSeconds = 2 | 4 | 6 | 8;

	const aspectRatios: AspectRatio[] = ['1:1', '4:3', '16:9', '9:16'];
	const durations: DurationSeconds[] = [2, 4, 6, 8];
	const starterPrompt =
		'A refined terracotta outline leaf that gently draws itself on, settles with a subtle ease-in-out sway, and loops cleanly on a transparent background.';

	const client = useConvexClient();
	const lottieGenerations = useQuery(api.lottieGenerations.getByUserWithUrls, {});

	let prompt = $state(starterPrompt);
	let aspectRatio = $state<AspectRatio>('1:1');
	let durationSeconds = $state<DurationSeconds>(4);
	let grounding = $state('');
	let submitting = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');

	const hasGenerations = $derived(
		Boolean(!lottieGenerations.isLoading && lottieGenerations.data?.length)
	);
	const activeCount = $derived(
		lottieGenerations.data?.filter((item) =>
			item.status === 'queued' || item.status === 'generating' || item.status === 'repairing'
		).length ?? 0
	);
	const canSubmit = $derived(prompt.trim().length > 0 && !submitting);



	async function handleSubmit() {
		const trimmed = prompt.trim();
		if (!trimmed || submitting) return;

		submitting = true;
		errorMessage = '';
		successMessage = '';

		try {
			await client.mutation(api.lottieGenerations.requestLottieGeneration, {
				aspectRatio,
				durationSeconds,
				grounding: grounding.trim() || undefined,
				prompt: trimmed
			});
			if (browser) {
				initPostHog();
				posthog.capture('lottie_generation_requested', {
					aspect_ratio: aspectRatio,
					duration_seconds: durationSeconds
				});
			}
			successMessage = 'Lottie JSON queued.';
		} catch (error) {
			errorMessage = error instanceof ConvexError ? String(error.data) : getErrorMessage(error, 'Lottie generation failed.');
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Motion — Celstate</title>
</svelte:head>

<PageContainer max="4xl" class="min-w-0 py-6 sm:py-8">
	<div class="mb-8 min-w-0">
		<SectionLabel text="Motion workspace" />
		<div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div class="min-w-0">
				<h1 class="font-display text-2xl tracking-tight text-balance text-text italic">
					Generate Lottie JSON
				</h1>
				<p class="mt-2 max-w-2xl text-sm leading-relaxed text-dim">
					{activeCount} active {activeCount === 1 ? 'request' : 'requests'}
				</p>
			</div>
		</div>
	</div>

	<div class="mb-10 border border-border px-4 py-4 sm:px-5 sm:py-5">
		<form class="space-y-6" onsubmit={(event) => { event.preventDefault(); void handleSubmit(); }}>
			<div class="min-w-0">
				<label for="lottie-prompt" class="mb-3 block text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
					Brief
				</label>
				<textarea
					id="lottie-prompt"
					bind:value={prompt}
					rows="5"
					class="min-h-36 w-full resize-y border border-border bg-transparent px-3 py-3 text-sm leading-relaxed text-text outline-none transition-colors placeholder:text-dim/60 focus:border-accent/40"
					placeholder={starterPrompt}
				></textarea>
			</div>

			<div class="min-w-0">
				<label for="lottie-grounding" class="mb-3 block text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
					Reference SVG or grounding (optional)
				</label>
				<textarea
					id="lottie-grounding"
					bind:value={grounding}
					rows="3"
					class="w-full resize-y border border-border bg-transparent px-3 py-3 text-xs leading-relaxed text-text outline-none transition-colors placeholder:text-dim/60 focus:border-accent/40"
					placeholder="Paste SVG markup or reference notes to ground the motion. Optional, but improves fidelity."
				></textarea>
			</div>

			<div class="grid gap-5 sm:grid-cols-2">
				<div class="min-w-0">
					<p class="mb-3 text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
						Frame
					</p>
					<div class="flex flex-wrap gap-2">
						{#each aspectRatios as value}
							<button
								type="button"
								onclick={() => (aspectRatio = value)}
								class="rounded-full border px-3 py-2 text-[10px] font-medium tracking-[0.06em] uppercase transition-colors {aspectRatio === value ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border text-dim hover:border-accent/30 hover:text-text'}"
							>
								{value}
							</button>
						{/each}
					</div>
				</div>

				<div class="min-w-0">
					<p class="mb-3 text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
						Duration
					</p>
					<div class="flex flex-wrap gap-2">
						{#each durations as value}
							<button
								type="button"
								onclick={() => (durationSeconds = value)}
								class="rounded-full border px-3 py-2 text-[10px] font-medium tracking-[0.06em] uppercase transition-colors {durationSeconds === value ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border text-dim hover:border-accent/30 hover:text-text'}"
							>
								{value}s
							</button>
						{/each}
					</div>
				</div>
			</div>

			<div class="flex min-w-0 flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
				<p class="min-w-0 text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
					Transparent vector animation · JSON only
				</p>
				<button
					type="submit"
					disabled={!canSubmit}
					class="inline-flex shrink-0 items-center justify-center rounded-full bg-accent px-5 py-2.5 text-[11px] font-medium tracking-[0.06em] text-white uppercase transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{submitting ? 'Queueing' : 'Generate Lottie'}
				</button>
			</div>
		</form>
	</div>

	{#if successMessage}
		<div class="mb-6 border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
			{successMessage}
		</div>
	{/if}

	{#if errorMessage}
		<div class="mb-6 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
			{errorMessage}
		</div>
	{/if}

	{#if lottieGenerations.isLoading}
		<div class="flex items-center justify-center py-16">
			<span class="text-xs font-medium tracking-[0.06em] text-dim uppercase">Loading motion history...</span>
		</div>
	{:else if hasGenerations}
		<div class="mb-6">
			<SectionLabel text="Lottie JSON" />
		</div>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
			{#each lottieGenerations.data! as gen (gen._id)}
				<LottieGenerationCard
					generationId={gen._id}
					aspectRatio={gen.aspectRatio}
					attemptCount={gen.attemptCount}
					createdAt={gen.createdAt}
					durationSeconds={gen.durationSeconds}
					error={gen.error}
					fps={gen.fps}
					lottieUrl={gen.lottieUrl}
					prompt={gen.prompt}
					status={gen.status}
					statusMessage={gen.statusMessage}
					validation={gen.validation}
				/>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col items-center justify-center px-2 py-16 sm:py-20">
			<div class="motion-empty mb-6" aria-hidden="true">
				{#each Array(18) as _, index}
					<span style="animation-delay: {index * 90}ms"></span>
				{/each}
			</div>
			<p class="mb-1 max-w-md text-center text-sm text-dim">No Lottie generations yet</p>
			<p class="max-w-md text-pretty text-center text-xs text-dim/60">
				Write a brief above to generate your first transparent animation JSON.
			</p>
		</div>
	{/if}
</PageContainer>

<style>
	.motion-empty {
		display: grid;
		grid-template-columns: repeat(6, 8px);
		gap: 4px;
	}

	.motion-empty span {
		height: 8px;
		width: 8px;
		background: var(--color-border);
		animation: motion-empty-breathe 2.4s cubic-bezier(0.25, 1, 0.5, 1) infinite;
	}

	@keyframes motion-empty-breathe {
		0%, 100% {
			opacity: 0.25;
			transform: translateY(0);
		}
		50% {
			opacity: 0.7;
			transform: translateY(-3px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.motion-empty span {
			animation: none;
			opacity: 0.45;
		}
	}
</style>
