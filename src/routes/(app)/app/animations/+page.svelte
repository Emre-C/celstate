<script lang="ts">
	import { browser } from '$app/environment';
	import { useConvexClient, useQuery } from '@mmailaender/convex-svelte';
	import { ConvexError } from 'convex/values';
	import { api } from '../../../../convex/_generated/api.js';
	import AnimationGenerationCard from '$lib/components/AnimationGenerationCard.svelte';
	import PageContainer from '$lib/components/ui/PageContainer.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { initPostHog, posthog } from '$lib/analytics/client-posthog';

	type UseCase =
		| 'stream_alert'
		| 'stinger_transition'
		| 'mascot_reaction'
		| 'logo_sting'
		| 'lower_third'
		| 'video_callout'
		| 'creator_overlay';

	type Destination = 'obs' | 'video_editor' | 'obs_and_video_editor';

	const useCases: Array<{ label: string; value: UseCase }> = [
		{ label: 'Stream alert', value: 'stream_alert' },
		{ label: 'Stinger', value: 'stinger_transition' },
		{ label: 'Mascot', value: 'mascot_reaction' },
		{ label: 'Logo sting', value: 'logo_sting' },
		{ label: 'Lower third', value: 'lower_third' },
		{ label: 'Callout', value: 'video_callout' },
		{ label: 'Overlay', value: 'creator_overlay' }
	];

	const destinations: Array<{ label: string; value: Destination }> = [
		{ label: 'OBS / streaming', value: 'obs' },
		{ label: 'Video editor', value: 'video_editor' },
		{ label: 'Both', value: 'obs_and_video_editor' }
	];

	const durations = [4, 6, 8] as const;
	const ratios = ['16:9', '9:16'] as const;

	const client = useConvexClient();
	const user = useQuery(api.users.getMe, {});
	const animationGenerations = useQuery(api.animationGenerations.getByUserWithUrls, {});

	let useCase = $state<UseCase>('stream_alert');
	let destination = $state<Destination>('obs');
	let prompt = $state('');
	let channelName = $state('');
	let creatorHandle = $state('');
	let brandColors = $state('');
	let durationSeconds = $state<(typeof durations)[number]>(4);
	let aspectRatio = $state<(typeof ratios)[number]>('16:9');
	let submitting = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');

	const credits = $derived(user.data?.credits ?? 0);
	const hasAnimationGenerations = $derived(
		!animationGenerations.isLoading
		&& animationGenerations.data
		&& animationGenerations.data.length > 0
	);
	const canSubmit = $derived(prompt.trim().length > 0 && !submitting);

	function parseBrandColors(value: string): string[] | undefined {
		const colors = value
			.split(',')
			.map((color) => color.trim())
			.filter((color) => color.length > 0)
			.slice(0, 6);

		return colors.length > 0 ? colors : undefined;
	}

	async function handleSubmit() {
		const trimmed = prompt.trim();
		if (!trimmed || submitting) return;

		submitting = true;
		errorMessage = '';
		successMessage = '';

		try {
			await client.mutation(api.animationGenerations.requestAnimationGeneration, {
				aspectRatio,
				brandInputs: {
					channelName: channelName.trim() || undefined,
					colors: parseBrandColors(brandColors),
					creatorHandle: creatorHandle.trim() || undefined
				},
				destination,
				durationSeconds,
				prompt: trimmed,
				useCase
			});

			if (browser) {
				initPostHog();
				posthog.capture('animation_generation_requested', {
					aspect_ratio: aspectRatio,
					destination,
					duration_seconds: durationSeconds,
					use_case: useCase
				});
			}

			prompt = '';
			successMessage = 'Motion request received.';
		} catch (error) {
			if (error instanceof ConvexError) {
				errorMessage = String(error.data);
			} else {
				errorMessage = error instanceof Error ? error.message : 'Animation request failed.';
			}
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Animations — Celstate</title>
</svelte:head>

<PageContainer max="4xl" class="min-w-0 py-6 sm:py-8">
	<div class="mb-8 min-w-0">
		<SectionLabel text="Motion workspace" />
		<h1 class="font-display text-2xl tracking-tight text-balance text-text italic">
			Transparent motion for creator and editor workflows
		</h1>
	</div>

	<div class="mb-10 border border-border px-4 py-4 sm:px-5 sm:py-5">
		<form class="space-y-6" onsubmit={(event) => { event.preventDefault(); void handleSubmit(); }}>
			<div class="min-w-0">
				<p class="mb-3 text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
					Asset type
				</p>
				<div class="flex min-w-0 flex-wrap gap-2">
					{#each useCases as item}
						<button
							type="button"
							onclick={() => (useCase = item.value)}
							class="rounded-full border px-3 py-2 text-[10px] font-medium tracking-[0.06em] uppercase transition-colors {useCase === item.value ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border text-dim hover:border-accent/30 hover:text-text'}"
						>
							{item.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="min-w-0">
				<label for="animation-prompt" class="mb-3 block text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
					Brief
				</label>
				<textarea
					id="animation-prompt"
					bind:value={prompt}
					rows="4"
					placeholder="Cozy forest-spirit raid alert for my VTuber stream..."
					class="min-h-32 w-full resize-y border border-border bg-transparent px-3 py-3 text-sm leading-relaxed text-text outline-none transition-colors placeholder:text-dim/60 focus:border-accent/40"
				></textarea>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<label class="min-w-0">
					<span class="mb-2 block text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
						Channel or brand
					</span>
					<input
						type="text"
						bind:value={channelName}
						class="w-full border border-border bg-transparent px-3 py-2.5 text-sm text-text outline-none transition-colors placeholder:text-dim/60 focus:border-accent/40"
						placeholder="Celstate Live"
					/>
				</label>
				<label class="min-w-0">
					<span class="mb-2 block text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
						Creator handle
					</span>
					<input
						type="text"
						bind:value={creatorHandle}
						class="w-full border border-border bg-transparent px-3 py-2.5 text-sm text-text outline-none transition-colors placeholder:text-dim/60 focus:border-accent/40"
						placeholder="@celstate"
					/>
				</label>
			</div>

			<label class="block min-w-0">
				<span class="mb-2 block text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
					Brand colors
				</span>
				<input
					type="text"
					bind:value={brandColors}
					class="w-full border border-border bg-transparent px-3 py-2.5 text-sm text-text outline-none transition-colors placeholder:text-dim/60 focus:border-accent/40"
					placeholder="#C2410C, warm cream, stone gray"
				/>
			</label>

			<div class="grid gap-5 sm:grid-cols-3">
				<div class="min-w-0">
					<p class="mb-3 text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
						Destination
					</p>
					<div class="flex flex-wrap gap-2">
						{#each destinations as item}
							<button
								type="button"
								onclick={() => (destination = item.value)}
								class="rounded-full border px-3 py-2 text-[10px] font-medium tracking-[0.06em] uppercase transition-colors {destination === item.value ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border text-dim hover:border-accent/30 hover:text-text'}"
							>
								{item.label}
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

				<div class="min-w-0">
					<p class="mb-3 text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
						Frame
					</p>
					<div class="flex flex-wrap gap-2">
						{#each ratios as value}
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
			</div>

			<div class="flex min-w-0 flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
				<p class="min-w-0 text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
					Pilot request · <span class="tabular-nums">{credits}</span> image {credits === 1 ? 'credit' : 'credits'} available
				</p>
				<button
					type="submit"
					disabled={!canSubmit}
					class="inline-flex shrink-0 items-center justify-center rounded-full bg-accent px-5 py-2.5 text-[11px] font-medium tracking-[0.06em] text-white uppercase transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{submitting ? 'Queueing' : 'Request animation'}
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

	{#if animationGenerations.isLoading}
		<div class="flex items-center justify-center py-16">
			<span class="text-xs font-medium tracking-[0.06em] text-dim uppercase">Loading motion requests...</span>
		</div>
	{:else if hasAnimationGenerations}
		<div class="mb-6">
			<SectionLabel text="Motion history" />
		</div>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
			{#each animationGenerations.data! as gen (gen._id)}
				<AnimationGenerationCard
					aspectRatio={gen.aspectRatio}
					createdAt={gen.createdAt}
					destination={gen.destination}
					durationSeconds={gen.durationSeconds}
					error={gen.error}
					exportUrls={gen.exportUrls}
					previewUrl={gen.previewUrl}
					prompt={gen.prompt}
					status={gen.status}
					statusMessage={gen.statusMessage}
					useCase={gen.useCase}
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
			<p class="mb-1 max-w-md text-center text-sm text-dim">No motion requests yet</p>
			<p class="max-w-md text-pretty text-center text-xs text-dim/60">
				Queue a creator or editor asset above.
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
