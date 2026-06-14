<script lang="ts">
	import GeneratingIndicator from './GeneratingIndicator.svelte';
	import MonoLabel from './ui/MonoLabel.svelte';
	import { formatTimeAgo, toDownloadFileSlug } from '../utils/format.js';
	import { downloadUrlAsFile } from '../utils/download.js';

	type AnimationStatus =
		| 'intake'
		| 'queued'
		| 'generating_reference'
		| 'reconstructing_alpha'
		| 'qa'
		| 'exporting'
		| 'complete'
		| 'failed';

	type ExportUrls = {
		apngUrl?: string | null;
		pngSequenceUrl?: string | null;
		runtimeManifestUrl?: string | null;
		spriteSheetUrl?: string | null;
		webpSpriteSheetUrl?: string | null;
	};

	let {
		aspectRatio,
		createdAt,
		destination,
		durationSeconds,
		error,
		exportUrls,
		previewUrl,
		prompt,
		status,
		statusMessage,
		useCase
	}: {
		aspectRatio: string;
		createdAt: number;
		destination: string;
		durationSeconds: number;
		error?: string;
		exportUrls?: ExportUrls;
		previewUrl?: string | null;
		prompt: string;
		status: AnimationStatus;
		statusMessage?: string;
		useCase: string;
	} = $props();

	let downloading = $state<string | false>(false);

	const statusLabel = $derived(getStatusLabel(status));
	const destinationLabel = $derived(getDestinationLabel(destination));
	const useCaseLabel = $derived(getUseCaseLabel(useCase));
	const availableExports = $derived(
		[
			{ label: 'Runtime', suffix: '-runtime.json', url: exportUrls?.runtimeManifestUrl },
			{ label: 'WebP sheet', suffix: '-sheet.webp', url: exportUrls?.webpSpriteSheetUrl },
			{ label: 'PNG sheet', suffix: '-sheet.png', url: exportUrls?.spriteSheetUrl },
			{ label: 'APNG', suffix: '.apng', url: exportUrls?.apngUrl },
			{ label: 'Frames', suffix: '-frames.zip', url: exportUrls?.pngSequenceUrl }
		].filter((item) => !!item.url)
	);
	const safeName = $derived(toDownloadFileSlug(prompt));

	function getStatusLabel(value: AnimationStatus): string {
		switch (value) {
			case 'intake':
				return 'Received';
			case 'queued':
			case 'generating_reference':
				return 'Designing';
			case 'reconstructing_alpha':
				return 'Refining transparency';
			case 'qa':
				return 'Checking export quality';
			case 'exporting':
				return 'Packaging';
			case 'complete':
				return 'Ready';
			case 'failed':
				return 'Failed';
		}
	}

	function getDestinationLabel(value: string): string {
		switch (value) {
			case 'react_native_runtime':
				return 'React Native';
			case 'web_runtime':
				return 'Web runtime';
			case 'runtime_bundle':
				return 'Runtime bundle';
			default:
				return value;
		}
	}

	function getUseCaseLabel(value: string): string {
		switch (value) {
			case 'small_accent':
				return 'Small accent';
			case 'interactive_control':
				return 'Interactive control';
			case 'button_overlay':
				return 'Button overlay';
			case 'ambient_background':
				return 'Ambient field';
			case 'loader_feedback':
				return 'State feedback';
		}
		return value
			.split('_')
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}

	async function handleDownload(url: string, suffix: string) {
		if (!url || downloading) return;
		downloading = suffix;
		try {
			await downloadUrlAsFile(url, `celstate-${safeName}${suffix}`);
		} finally {
			downloading = false;
		}
	}
</script>

<div class="min-w-0 border border-border transition-colors hover:border-accent/20">
	<div class="checkerboard-bg flex aspect-video items-center justify-center overflow-hidden">
		{#if status === 'complete' && previewUrl}
			<img src={previewUrl} alt={prompt} class="h-full w-full object-contain" />
		{:else if status === 'failed'}
			<div class="flex flex-col items-center gap-3 px-4 text-center">
				<svg class="h-6 w-6 text-red-500/70" viewBox="0 0 24 24" fill="none">
					<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" />
					<path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
				</svg>
				<MonoLabel class="text-red-600">Animation failed</MonoLabel>
			</div>
		{:else if status === 'intake'}
			<div class="flex flex-col items-center gap-3 px-4 text-center">
				<svg class="h-6 w-6 text-accent/70" viewBox="0 0 24 24" fill="none">
					<path d="M5 12.5l4 4 10-10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				<MonoLabel>Pilot request received</MonoLabel>
			</div>
		{:else}
			<GeneratingIndicator {prompt} statusMessage={statusMessage ?? statusLabel} {createdAt} />
		{/if}
	</div>

	<div class="border-t border-border">
		<div class="min-w-0 px-4 pt-3 pb-2">
			<div class="mb-2 flex min-w-0 flex-wrap items-center gap-2">
				<MonoLabel>{statusLabel}</MonoLabel>
				<MonoLabel>{useCaseLabel}</MonoLabel>
				<MonoLabel>{destinationLabel}</MonoLabel>
				<MonoLabel>{durationSeconds}s</MonoLabel>
				<MonoLabel>{aspectRatio}</MonoLabel>
				<MonoLabel>{formatTimeAgo(createdAt)}</MonoLabel>
			</div>
			<p class="line-clamp-2 break-words text-sm text-dim">{prompt}</p>
			{#if error}
				<p class="mt-2 break-words text-xs text-red-700">{error}</p>
			{/if}
		</div>

		{#if status === 'complete' && availableExports.length > 0}
			<div class="grid border-t border-border [grid-template-columns:repeat(auto-fit,minmax(5.25rem,1fr))]">
				{#each availableExports as item, index}
					<button
						type="button"
						onclick={() => handleDownload(item.url!, item.suffix)}
						disabled={!!downloading}
						class="flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap py-2.5 text-[10px] font-medium uppercase tracking-[0.06em] text-accent transition-colors hover:bg-accent/10 disabled:opacity-50 {index === 0 ? '' : 'border-l border-border'}"
					>
						<svg class="h-3 w-3 shrink-0" viewBox="0 0 12 12" fill="none">
							<path d="M6 1v7M3 6l3 3 3-3M2 10h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
						{downloading === item.suffix ? 'Saving' : item.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
