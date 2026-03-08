<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api.js';
	import PromptInput from '$lib/components/PromptInput.svelte';
	import GenerationCard from '$lib/components/GenerationCard.svelte';

	const client = useConvexClient();
	const user = useQuery(api.users.getMe, {});
	const generations = useQuery(api.generations.getByUserWithUrls, {});

	let errorMessage = $state('');

	const activeGeneration = $derived(
		generations.data?.find((g) => g.status === 'generating')
	);
	const generating = $derived(!!activeGeneration);

	async function handleGenerate(prompt: string) {
		if (generating) return;
		errorMessage = '';

		try {
			await client.mutation(api.generations.requestGeneration, { prompt });
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : 'Generation failed. Please try again.';
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

<div class="px-6 py-8 sm:px-16 md:px-24 lg:px-32">
	<div class="mx-auto max-w-4xl">
		<!-- Header -->
		<div class="mb-8">
			<p class="mb-2 font-mono text-xs tracking-[0.15em] uppercase text-dim">
				<span class="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent"></span>
				Generation workspace
			</p>
			<h1 class="text-2xl font-light tracking-tight text-text">
				What do you need?
			</h1>
		</div>

		<!-- Prompt Input -->
		<div class="mb-10">
			<PromptInput
				onsubmit={handleGenerate}
				disabled={generating}
				{credits}
			/>
		</div>

		<!-- Error message -->
		{#if errorMessage}
			<div class="mb-6 border border-red-900/40 bg-red-950/10 px-4 py-3">
				<div class="flex items-center gap-2">
					<svg class="h-4 w-4 shrink-0 text-red-500/60" viewBox="0 0 16 16" fill="none">
						<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2" />
						<path d="M8 4v5M8 11v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
					</svg>
					<p class="text-sm text-red-400/80">{errorMessage}</p>
				</div>
			</div>
		{/if}

		<!-- Generation results -->
		{#if generations.isLoading}
			<div class="flex items-center justify-center py-16">
				<span class="font-mono text-xs tracking-[0.15em] uppercase text-dim">Loading history...</span>
			</div>
		{:else if hasGenerations}
			<!-- Section label -->
			<div class="mb-6">
				<p class="font-mono text-xs tracking-[0.15em] uppercase text-dim">
					<span class="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent"></span>
					Your generations
				</p>
			</div>

			<!-- Grid of generation cards -->
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each generations.data! as gen (gen._id)}
					<GenerationCard
						prompt={gen.prompt}
						status={gen.status}
						statusMessage={gen.statusMessage}
						resultUrl={gen.resultUrl ?? undefined}
						error={gen.error}
						createdAt={gen.createdAt}
						completedAt={gen.completedAt}
						generationTimeMs={gen.generationTimeMs}
					/>
				{/each}
			</div>
		{:else}
			<!-- Empty state -->
			<div class="flex flex-col items-center justify-center py-20">
				<div class="empty-state-grid mb-6" aria-hidden="true">
					{#each Array(16) as _, i}
						<div class="empty-cell" style="animation-delay: {i * 150}ms"></div>
					{/each}
				</div>
				<p class="mb-1 text-sm text-dim">No generations yet</p>
				<p class="text-xs text-dim/60">
					Type a prompt above to generate your first transparent image.
				</p>
			</div>
		{/if}
	</div>
</div>

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
</style>
