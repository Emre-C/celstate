<script lang="ts">
	import CheckerboardPreview from './CheckerboardPreview.svelte';
	import GeneratingIndicator from './GeneratingIndicator.svelte';
	import MonoLabel from './ui/MonoLabel.svelte';
	import { formatTimeAgo, toDownloadFileSlug } from '../utils/format.js';
	import { downloadUrlAsFile } from '../utils/download.js';
	import { initPostHog, posthog } from '../analytics/client-posthog';
	import { growthEvents, type ImageDownloadVariant } from '../analytics/growth-events.js';
	import { useConvexClient, useQuery } from '@mmailaender/convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';

	let {
		generationId,
		prompt,
		status,
		statusMessage,
		resultUrl,
		optimizedUrl,
		referenceUrls = [],
		error,
		createdAt,
		completedAt,
		generationTimeMs,
		aspectRatio = '1:1'
	}: {
		generationId: string;
		prompt: string;
		status: 'generating' | 'complete' | 'failed';
		statusMessage?: string;
		resultUrl?: string;
		optimizedUrl?: string;
		referenceUrls?: string[];
		error?: string;
		createdAt: number;
		completedAt?: number;
		generationTimeMs?: number;
		aspectRatio?: string;
	} = $props();

	const client = useConvexClient();
	// svelte-ignore state_referenced_locally
	const feedback = useQuery(api.generations.getFeedbackForGeneration, {
		generationId: generationId as Id<'generations'>,
	});

	let submittingFeedback = $state(false);

	const ratioLabel = $derived(aspectRatio !== '1:1' ? aspectRatio : '');

	let downloading = $state<string | false>(false);

	function formatTime(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	const safeName = $derived(toDownloadFileSlug(prompt));

	async function handleDownload(url: string, suffix: string) {
		if (!url || downloading) return;
		downloading = suffix;
		try {
			await downloadUrlAsFile(url, `celstate-${safeName}${suffix}.png`);
			if (initPostHog()) {
				posthog.capture(growthEvents.imageDownloaded, {
					generation_id: generationId,
					variant: (suffix === '-hires' ? 'hires' : 'standard') as ImageDownloadVariant,
					aspect_ratio: aspectRatio,
				});
			}
			await client.mutation(api.generations.recordDownload, {
				generationId: generationId as Id<'generations'>,
			});
		} catch (err) {
			console.error('[GenerationCard] download or tracking failed', err);
		} finally {
			downloading = false;
		}
	}

	async function handleFeedback(rating: 'up' | 'down') {
		if (submittingFeedback) return;
		submittingFeedback = true;
		try {
			await client.mutation(api.generations.submitFeedback, {
				generationId: generationId as Id<'generations'>,
				rating,
			});
			if (initPostHog()) {
				posthog.capture('generation_feedback_submitted', {
					generation_id: generationId,
					rating,
				});
			}
		} finally {
			submittingFeedback = false;
		}
	}
</script>

{#if status === 'generating'}
	<div class="min-w-0 border border-border">
		<div class="aspect-square flex items-center justify-center bg-bg">
			<GeneratingIndicator {prompt} {statusMessage} {createdAt} />
		</div>
		<div class="min-w-0 border-t border-border px-4 py-3">
			<p class="line-clamp-1 break-words text-xs text-dim">{prompt}</p>
		</div>
	</div>
{:else if status === 'complete' && resultUrl}
	<div
		class="group flex min-w-0 flex-col border border-border transition-colors hover:border-accent/20"
	>
		<CheckerboardPreview src={resultUrl} alt={prompt} class="aspect-square" />
		<div class="flex flex-1 flex-col border-t border-border">
			<div class="min-w-0 flex-1 px-4 pt-3 pb-2">
				<p class="line-clamp-2 break-words text-sm text-dim">{prompt}</p>
			</div>
			<div class="flex min-w-0 flex-wrap items-center gap-2 gap-x-3 px-4 pb-3">
				{#if referenceUrls.length > 0}
					<div class="flex items-center gap-1.5" title="Generated with style reference">
						<div class="flex -space-x-1">
							{#each referenceUrls.slice(0, 3) as url}
								<div class="h-4 w-4 shrink-0 overflow-hidden border border-border">
									<img src={url} alt="Ref" class="h-full w-full object-cover" />
								</div>
							{/each}
						</div>
						<MonoLabel>{referenceUrls.length > 1 ? `${referenceUrls.length} Refs` : 'Ref'}</MonoLabel>
					</div>
				{/if}
				{#if ratioLabel}
					<MonoLabel>{ratioLabel}</MonoLabel>
				{/if}
				{#if generationTimeMs}
					<MonoLabel>{formatTime(generationTimeMs)}</MonoLabel>
				{/if}
				<MonoLabel>{formatTimeAgo(createdAt)}</MonoLabel>
			</div>
			<div class="flex items-center gap-1 px-4 pb-2">
				<span class="mr-1 text-[10px] font-medium uppercase tracking-[0.06em] text-dim/60">Match?</span>
				<button
					type="button"
					onclick={() => handleFeedback('up')}
					disabled={submittingFeedback}
					aria-label="Thumbs up — this matched what I wanted"
					class="flex h-6 w-6 items-center justify-center transition-colors disabled:opacity-50 {feedback.data?.rating === 'up' ? 'text-accent' : 'text-dim/40 hover:text-dim'}"
				>
					<svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
						<path d="M2 7h2.5L7 3.5C7.5 3 8.5 3.3 8.5 4v3.5L12.5 7c.8 0 1.3.8 1 1.5l-1.5 4c-.2.5-.7.5-1 .5H4.5c-.3 0-.5-.2-.5-.5V7Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
					</svg>
				</button>
				<button
					type="button"
					onclick={() => handleFeedback('down')}
					disabled={submittingFeedback}
					aria-label="Thumbs down — this didn't match what I wanted"
					class="flex h-6 w-6 items-center justify-center transition-colors disabled:opacity-50 {feedback.data?.rating === 'down' ? 'text-accent' : 'text-dim/40 hover:text-dim'}"
				>
					<svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
						<path d="M14 9h-2.5L9 12.5c-.5.5-1.5.2-1.5-.5V8.5L3.5 9c-.8 0-1.3-.8-1-1.5L4 3.5c.2-.5.7-.5 1-.5h6c.3 0 .5.2.5.5V9Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
					</svg>
				</button>
			</div>
			<div class="border-t border-border">
				{#if optimizedUrl}
					<div class="grid grid-cols-2">
						<button
							onclick={() => handleDownload(optimizedUrl!, '')}
							disabled={!!downloading}
							class="flex items-center justify-center gap-1.5 whitespace-nowrap py-2.5 text-[10px] font-medium uppercase tracking-[0.06em] text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
						>
							<svg class="h-3 w-3 shrink-0" viewBox="0 0 12 12" fill="none">
								<path d="M6 1v7M3 6l3 3 3-3M2 10h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
							{downloading === '' ? 'Saving…' : 'Standard'}
						</button>
						<button
							onclick={() => handleDownload(resultUrl!, '-hires')}
							disabled={!!downloading}
							class="flex items-center justify-center gap-1.5 whitespace-nowrap border-l border-border py-2.5 text-[10px] font-medium uppercase tracking-[0.06em] text-dim transition-colors hover:bg-accent/10 hover:text-text disabled:opacity-50"
						>
							<svg class="h-3 w-3 shrink-0" viewBox="0 0 12 12" fill="none">
								<path d="M6 1v7M3 6l3 3 3-3M2 10h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
							{downloading === '-hires' ? 'Saving…' : 'Hi-Res'}
						</button>
					</div>
				{:else}
					<button
						onclick={() => handleDownload(resultUrl!, '')}
						disabled={!!downloading}
						class="flex w-full items-center justify-center gap-1.5 whitespace-nowrap py-2.5 text-[10px] font-medium uppercase tracking-[0.06em] text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
					>
						<svg class="h-3 w-3 shrink-0" viewBox="0 0 12 12" fill="none">
							<path d="M6 1v7M3 6l3 3 3-3M2 10h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
						{downloading === '' ? 'Saving…' : 'Download'}
					</button>
				{/if}
			</div>
		</div>
	</div>
{:else if status === 'failed'}
	<div class="min-w-0 border border-red-300 bg-red-50">
		<div class="aspect-square flex flex-col items-center justify-center gap-3 px-4 sm:px-6">
			<svg class="h-6 w-6 text-red-500/60" viewBox="0 0 24 24" fill="none">
				<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" />
				<path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
			<MonoLabel class="text-red-600">Generation failed</MonoLabel>
			{#if error}
				<p class="w-full max-w-full break-words px-1 text-center text-xs text-dim">{error}</p>
			{/if}
		</div>
		<div class="min-w-0 border-t border-red-200 px-4 py-3">
			<p class="line-clamp-1 break-words text-xs text-dim">{prompt}</p>
		</div>
	</div>
{/if}
