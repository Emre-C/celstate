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
		| 'small_accent'
		| 'interactive_control'
		| 'button_overlay'
		| 'ambient_background'
		| 'loader_feedback';

	type Destination = 'react_native_runtime' | 'web_runtime' | 'runtime_bundle';
	type AspectRatio = '1:1' | '4:3' | '16:9' | '9:16';
	type DurationSeconds = 2 | 4 | 6 | 8;

	type LivingUseCase = {
		aspectRatio: AspectRatio;
		durationSeconds: DurationSeconds;
		example: string;
		label: string;
		path: 'A/C' | 'B' | 'C';
		prompt: string;
		value: UseCase;
	};

	const useCases: LivingUseCase[] = [
		{
			aspectRatio: '1:1',
			durationSeconds: 2,
			example: 'swaying leaf icon',
			label: 'Small accent',
			path: 'A/C',
			prompt: 'A single parchment-toned leaf icon with burnt terracotta veins, centered with generous transparent padding, subtle swaying motion, crisp bounded edges, no glow, no text.',
			value: 'small_accent'
		},
		{
			aspectRatio: '4:3',
			durationSeconds: 4,
			example: 'slider on rails',
			label: 'Interactive control',
			path: 'B',
			prompt: 'A tactile slider thumb riding warm brass rails with tiny moss details, designed as a transparent runtime control asset, structured motion, no app chrome, no labels.',
			value: 'interactive_control'
		},
		{
			aspectRatio: '4:3',
			durationSeconds: 4,
			example: 'swaying bush button',
			label: 'Button overlay',
			path: 'A/C',
			prompt: 'Overgrown olive-green bushes framing a rounded terracotta button edge, transparent overlay asset, gentle wind sway, premium editorial craft, no text, no dark background.',
			value: 'button_overlay'
		},
		{
			aspectRatio: '16:9',
			durationSeconds: 6,
			example: 'firefly field',
			label: 'Ambient field',
			path: 'C',
			prompt: 'A sparse cluster of warm fireflies and slender grass blades as transparent ambient field elements, designed for many runtime instances, subtle drift, no haze, no full background plate.',
			value: 'ambient_background'
		},
		{
			aspectRatio: '1:1',
			durationSeconds: 2,
			example: 'success bloom',
			label: 'State feedback',
			path: 'A/C',
			prompt: 'A compact living success bloom made of small terracotta petals and warm stone leaves, centered transparent loader asset, seamless loop, no confetti clutter, no glow.',
			value: 'loader_feedback'
		}
	];

	const destinations: Array<{ label: string; value: Destination }> = [
		{ label: 'React Native', value: 'react_native_runtime' },
		{ label: 'Runtime bundle', value: 'runtime_bundle' },
		{ label: 'Web preview', value: 'web_runtime' }
	];

	const durations: DurationSeconds[] = [2, 4, 6, 8];
	const ratios: AspectRatio[] = ['1:1', '4:3', '16:9', '9:16'];
	const useCaseSet = new Set<UseCase>(useCases.map((item) => item.value));

	const client = useConvexClient();
	const user = useQuery(api.users.getMe, {});
	const animationGenerations = useQuery(api.animationGenerations.getByUserWithUrls, {});

	let useCase = $state<UseCase>('small_accent');
	let destination = $state<Destination>('react_native_runtime');
	let prompt = $state(useCases[0]!.prompt);
	let channelName = $state('Celstate');
	let creatorHandle = $state('');
	let brandColors = $state('#F5F3ED, #C2410C, #78716C');
	let durationSeconds = $state<DurationSeconds>(2);
	let aspectRatio = $state<AspectRatio>('1:1');
	let submitting = $state(false);
	let submittingStarterSet = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');

	const credits = $derived(user.data?.credits ?? 0);
	const selectedUseCase = $derived(useCases.find((item) => item.value === useCase) ?? useCases[0]!);
	const hasAnimationGenerations = $derived(
		Boolean(!animationGenerations.isLoading && animationGenerations.data?.length)
	);
	const livingStatusByUseCase = $derived(buildLivingStatusByUseCase(animationGenerations.data ?? []));
	const completedUseCaseCount = $derived(
		useCases.filter((item) => livingStatusByUseCase.get(item.value) === 'complete').length
	);
	const canSubmit = $derived(prompt.trim().length > 0 && !submitting && !submittingStarterSet);
	const canQueueStarterSet = $derived(!submitting && !submittingStarterSet);

	function isLivingUseCase(value: string): value is UseCase {
		return useCaseSet.has(value as UseCase);
	}

	function buildLivingStatusByUseCase(
		generations: Array<{ status: string; useCase: string }>
	): Map<UseCase, string> {
		const statusByUseCase = new Map<UseCase, string>();
		for (const generation of generations) {
			if (!isLivingUseCase(generation.useCase)) continue;
			if (generation.status === 'complete') {
				statusByUseCase.set(generation.useCase, 'complete');
			} else if (!statusByUseCase.has(generation.useCase)) {
				statusByUseCase.set(generation.useCase, generation.status);
			}
		}
		return statusByUseCase;
	}

	function getCoverageLabel(value: UseCase): string {
		const status = livingStatusByUseCase.get(value);
		if (status === 'complete') return 'Ready';
		if (status) return 'Queued';
		return 'Open';
	}

	function parseBrandColors(value: string): string[] | undefined {
		const colors = value
			.split(',')
			.map((color) => color.trim())
			.filter((color) => color.length > 0)
			.slice(0, 6);

		return colors.length > 0 ? colors : undefined;
	}

	function applyPreset(item: LivingUseCase) {
		useCase = item.value;
		prompt = item.prompt;
		aspectRatio = item.aspectRatio;
		durationSeconds = item.durationSeconds;
	}

	function buildBrandInputs() {
		return {
			channelName: channelName.trim() || undefined,
			colors: parseBrandColors(brandColors),
			creatorHandle: creatorHandle.trim() || undefined
		};
	}

	async function requestLivingAsset(args: {
		aspectRatio: AspectRatio;
		durationSeconds: DurationSeconds;
		prompt: string;
		useCase: UseCase;
	}) {
		await client.mutation(api.animationGenerations.requestAnimationGeneration, {
			aspectRatio: args.aspectRatio,
			brandInputs: buildBrandInputs(),
			destination,
			durationSeconds: args.durationSeconds,
			prompt: args.prompt,
			useCase: args.useCase
		});
	}

	function trackRequest(kind: 'single' | 'starter_set') {
		if (!browser) return;
		initPostHog();
		posthog.capture('living_ui_asset_requested', {
			asset_class: kind === 'single' ? useCase : 'starter_set',
			destination,
			duration_seconds: kind === 'single' ? durationSeconds : undefined,
			request_kind: kind
		});
	}

	function normalizeError(error: unknown): string {
		if (error instanceof ConvexError) return String(error.data);
		return error instanceof Error ? error.message : 'Living UI request failed.';
	}

	async function handleSubmit() {
		const trimmed = prompt.trim();
		if (!trimmed || submitting || submittingStarterSet) return;

		submitting = true;
		errorMessage = '';
		successMessage = '';

		try {
			await requestLivingAsset({
				aspectRatio,
				durationSeconds,
				prompt: trimmed,
				useCase
			});
			trackRequest('single');
			successMessage = 'Runtime asset queued.';
		} catch (error) {
			errorMessage = normalizeError(error);
		} finally {
			submitting = false;
		}
	}

	async function handleQueueStarterSet() {
		if (submitting || submittingStarterSet) return;

		submittingStarterSet = true;
		errorMessage = '';
		successMessage = '';

		try {
			await Promise.all(
				useCases.map((item) =>
					requestLivingAsset({
						aspectRatio: item.aspectRatio,
						durationSeconds: item.durationSeconds,
						prompt: item.prompt,
						useCase: item.value
					})
				)
			);
			trackRequest('starter_set');
			successMessage = 'Starter set queued.';
		} catch (error) {
			errorMessage = normalizeError(error);
		} finally {
			submittingStarterSet = false;
		}
	}
</script>

<svelte:head>
	<title>Living UI — Celstate</title>
</svelte:head>

<PageContainer max="4xl" class="min-w-0 py-6 sm:py-8">
	<div class="mb-8 min-w-0">
		<SectionLabel text="Living UI" />
		<div class="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
			<div class="min-w-0">
				<h1 class="font-display text-2xl tracking-tight text-balance text-text italic">
					Runtime-ready transparent motion assets
				</h1>
				<p class="mt-2 max-w-2xl text-sm leading-relaxed text-dim">
					{completedUseCaseCount}/5 runtime classes ready
				</p>
			</div>
			<button
				type="button"
				onclick={handleQueueStarterSet}
				disabled={!canQueueStarterSet}
				class="inline-flex shrink-0 items-center justify-center rounded-full border border-border px-5 py-2.5 text-[11px] font-medium tracking-[0.06em] text-text uppercase transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
			>
				{submittingStarterSet ? 'Queueing set' : 'Queue starter set'}
			</button>
		</div>
	</div>

	<div class="mb-8 grid gap-px border border-border bg-border sm:grid-cols-5">
		{#each useCases as item}
			<button
				type="button"
				onclick={() => applyPreset(item)}
				class="min-w-0 bg-bg px-3 py-3 text-left transition-colors hover:bg-accent/5 {useCase === item.value ? 'text-accent' : 'text-text'}"
			>
				<span class="mb-2 block text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
					{getCoverageLabel(item.value)}
				</span>
				<span class="block text-sm font-semibold">{item.label}</span>
				<span class="mt-1 block text-xs text-dim">{item.example}</span>
				<span class="mt-2 block text-[10px] font-medium tracking-[0.06em] uppercase">
					Path {item.path}
				</span>
			</button>
		{/each}
	</div>

	<div class="mb-10 border border-border px-4 py-4 sm:px-5 sm:py-5">
		<form class="space-y-6" onsubmit={(event) => { event.preventDefault(); void handleSubmit(); }}>
			<div class="min-w-0">
				<p class="mb-3 text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
					Asset class
				</p>
				<div class="flex min-w-0 flex-wrap gap-2">
					{#each useCases as item}
						<button
							type="button"
							onclick={() => applyPreset(item)}
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
					placeholder={selectedUseCase.prompt}
					class="min-h-32 w-full resize-y border border-border bg-transparent px-3 py-3 text-sm leading-relaxed text-text outline-none transition-colors placeholder:text-dim/60 focus:border-accent/40"
				></textarea>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<label class="min-w-0">
					<span class="mb-2 block text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
						Brand
					</span>
					<input
						type="text"
						bind:value={channelName}
						class="w-full border border-border bg-transparent px-3 py-2.5 text-sm text-text outline-none transition-colors placeholder:text-dim/60 focus:border-accent/40"
						placeholder="Celstate"
					/>
				</label>
				<label class="min-w-0">
					<span class="mb-2 block text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
						Handle
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
					Palette
				</span>
				<input
					type="text"
					bind:value={brandColors}
					class="w-full border border-border bg-transparent px-3 py-2.5 text-sm text-text outline-none transition-colors placeholder:text-dim/60 focus:border-accent/40"
					placeholder="#F5F3ED, #C2410C, #78716C"
				/>
			</label>

			<div class="grid gap-5 sm:grid-cols-3">
				<div class="min-w-0">
					<p class="mb-3 text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
						Target
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
						Loop
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
					Runtime bundle · <span class="tabular-nums">{credits}</span> image {credits === 1 ? 'credit' : 'credits'} available
				</p>
				<button
					type="submit"
					disabled={!canSubmit}
					class="inline-flex shrink-0 items-center justify-center rounded-full bg-accent px-5 py-2.5 text-[11px] font-medium tracking-[0.06em] text-white uppercase transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{submitting ? 'Queueing' : 'Queue asset'}
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
			<span class="text-xs font-medium tracking-[0.06em] text-dim uppercase">Loading runtime assets...</span>
		</div>
	{:else if hasAnimationGenerations}
		<div class="mb-6">
			<SectionLabel text="Runtime assets" />
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
			<p class="mb-1 max-w-md text-center text-sm text-dim">No runtime assets yet</p>
			<p class="max-w-md text-pretty text-center text-xs text-dim/60">
				Queue a living asset above.
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
