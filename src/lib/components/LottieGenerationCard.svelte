<script lang="ts">
	import GeneratingIndicator from './GeneratingIndicator.svelte';
	import LottiePreview from './LottiePreview.svelte';
	import MonoLabel from './ui/MonoLabel.svelte';
	import { downloadUrlAsFile } from '../utils/download.js';
	import { formatTimeAgo, toDownloadFileSlug } from '../utils/format.js';
	import { initPostHog, posthog } from '../analytics/client-posthog';
	import { growthEvents } from '../analytics/growth-events.js';

	type LottieStatus = 'queued' | 'generating' | 'repairing' | 'complete' | 'failed';

	type Validation = {
		decision: 'pass' | 'fail';
		errors: string[];
		warnings: string[];
		version: string;
	};

	let {
		generationId,
		aspectRatio,
		attemptCount,
		createdAt,
		durationSeconds,
		error,
		fps,
		lottieUrl,
		prompt,
		status,
		statusMessage,
		validation
	}: {
		generationId: string;
		aspectRatio: string;
		attemptCount: number;
		createdAt: number;
		durationSeconds: number;
		error?: string;
		fps: number;
		lottieUrl?: string | null;
		prompt: string;
		status: LottieStatus;
		statusMessage?: string;
		validation?: Validation;
	} = $props();

	let downloading = $state(false);

	const statusLabel = $derived(getStatusLabel(status));
	const safeName = $derived(toDownloadFileSlug(prompt) || 'lottie-animation');
	const validationLabel = $derived(
		validation?.decision === 'pass'
			? 'Validated'
			: validation?.decision === 'fail'
				? 'Needs repair'
				: undefined
	);

	function getStatusLabel(value: LottieStatus): string {
		switch (value) {
			case 'queued':
				return 'Queued';
			case 'generating':
				return 'Authoring';
			case 'repairing':
				return 'Repairing';
			case 'complete':
				return 'Ready';
			case 'failed':
				return 'Failed';
		}
	}

	async function handleDownload() {
		if (!lottieUrl || downloading) return;
		downloading = true;
		try {
			await downloadUrlAsFile(lottieUrl, `celstate-${safeName}.json`);
			if (initPostHog()) {
				posthog.capture(growthEvents.lottieDownloaded, {
					generation_id: generationId,
					aspect_ratio: aspectRatio,
				});
			}
		} finally {
			downloading = false;
		}
	}
</script>

<div class="min-w-0 border border-border transition-colors hover:border-accent/20">
	<div class="relative min-w-0">
		{#if status === 'complete' && lottieUrl}
			<LottiePreview src={lottieUrl} label={prompt} />
		{:else if status === 'failed'}
			<div class="checkerboard-bg flex aspect-video flex-col items-center justify-center gap-3 px-4 text-center">
				<svg class="h-6 w-6 text-red-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" />
					<path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
				</svg>
				<MonoLabel class="text-red-700">Lottie failed</MonoLabel>
			</div>
		{:else}
			<div class="checkerboard-bg aspect-video">
				<GeneratingIndicator {prompt} statusMessage={statusMessage ?? statusLabel} {createdAt} />
			</div>
		{/if}
	</div>

	<div class="border-t border-border">
		<div class="min-w-0 px-4 pt-3 pb-2">
			<div class="mb-2 flex min-w-0 flex-wrap items-center gap-2">
				<MonoLabel>{statusLabel}</MonoLabel>
				<MonoLabel>{durationSeconds}s</MonoLabel>
				<MonoLabel>{fps}fps</MonoLabel>
				<MonoLabel>{aspectRatio}</MonoLabel>
				<MonoLabel>{formatTimeAgo(createdAt)}</MonoLabel>
				{#if attemptCount > 0}
					<MonoLabel>Attempt {attemptCount}</MonoLabel>
				{/if}
				{#if validationLabel}
					<MonoLabel>{validationLabel}</MonoLabel>
				{/if}
			</div>
			<p class="line-clamp-2 break-words text-sm text-dim">{prompt}</p>
			{#if error}
				<p class="mt-2 break-words text-xs text-red-700">{error}</p>
			{/if}
			{#if validation?.decision === 'fail' && validation.errors.length > 0}
				<p class="mt-2 line-clamp-2 break-words text-xs text-red-700">
					{validation.errors[0]}
				</p>
			{/if}
		</div>

		{#if status === 'complete' && lottieUrl}
			<div class="border-t border-border">
				<button
					type="button"
					onclick={handleDownload}
					disabled={downloading}
					class="flex w-full min-w-0 items-center justify-center gap-1.5 py-2.5 text-[10px] font-medium tracking-[0.06em] text-accent uppercase transition-colors hover:bg-accent/10 disabled:opacity-50"
				>
					<svg class="h-3 w-3 shrink-0" viewBox="0 0 12 12" fill="none" aria-hidden="true">
						<path d="M6 1v7M3 6l3 3 3-3M2 10h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					{downloading ? 'Saving' : 'Download JSON'}
				</button>
			</div>
		{/if}
	</div>
</div>
