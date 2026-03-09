<script lang="ts">
	import CheckerboardPreview from './CheckerboardPreview.svelte';
	import GeneratingIndicator from './GeneratingIndicator.svelte';
	import MonoLabel from './ui/MonoLabel.svelte';

	let {
		prompt,
		status,
		statusMessage,
		resultUrl,
		optimizedUrl,
		error,
		createdAt,
		completedAt,
		generationTimeMs
	}: {
		prompt: string;
		status: 'generating' | 'complete' | 'failed';
		statusMessage?: string;
		resultUrl?: string;
		optimizedUrl?: string;
		error?: string;
		createdAt: number;
		completedAt?: number;
		generationTimeMs?: number;
	} = $props();

	let downloading = $state<string | false>(false);

	function formatTime(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	function formatTimeAgo(timestamp: number): string {
		const seconds = Math.floor((Date.now() - timestamp) / 1000);
		if (seconds < 60) return 'just now';
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
		return `${Math.floor(seconds / 86400)}d ago`;
	}

	const safeName = $derived(
		prompt
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, '')
			.replace(/\s+/g, '-')
			.slice(0, 40)
	);

	async function handleDownload(url: string, suffix: string) {
		if (!url || downloading) return;
		downloading = suffix;
		try {
			const response = await fetch(url);
			const blob = await response.blob();
			const objectUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = objectUrl;
			a.download = `celstate-${safeName}${suffix}.png`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(objectUrl);
		} finally {
			downloading = false;
		}
	}
</script>

{#if status === 'generating'}
	<div class="overflow-hidden border border-border">
		<div class="aspect-square flex items-center justify-center overflow-hidden bg-bg">
			<GeneratingIndicator {prompt} {statusMessage} {createdAt} />
		</div>
		<div class="border-t border-border px-4 py-3">
			<p class="line-clamp-1 text-xs text-dim">{prompt}</p>
		</div>
	</div>
{:else if status === 'complete' && resultUrl}
	<div class="group flex flex-col border border-border transition-colors hover:border-accent/20">
		<CheckerboardPreview src={resultUrl} alt={prompt} class="aspect-square" />
		<div class="flex flex-1 flex-col border-t border-border">
			<div class="flex-1 px-4 pt-3 pb-2">
				<p class="line-clamp-2 text-sm text-dim">{prompt}</p>
			</div>
			<div class="flex items-center gap-3 px-4 pb-3">
				{#if generationTimeMs}
					<MonoLabel>{formatTime(generationTimeMs)}</MonoLabel>
				{/if}
				<MonoLabel>{formatTimeAgo(createdAt)}</MonoLabel>
			</div>
			<div class="border-t border-border">
				{#if optimizedUrl}
					<div class="grid grid-cols-2">
						<button
							onclick={() => handleDownload(optimizedUrl!, '')}
							disabled={!!downloading}
							class="flex items-center justify-center gap-1.5 whitespace-nowrap py-2.5 font-mono text-[10px] tracking-[0.15em] uppercase text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
						>
							<svg class="h-3 w-3 shrink-0" viewBox="0 0 12 12" fill="none">
								<path d="M6 1v7M3 6l3 3 3-3M2 10h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
							{downloading === '' ? 'Saving…' : 'Standard'}
						</button>
						<button
							onclick={() => handleDownload(resultUrl!, '-hires')}
							disabled={!!downloading}
							class="flex items-center justify-center gap-1.5 whitespace-nowrap border-l border-border py-2.5 font-mono text-[10px] tracking-[0.15em] uppercase text-dim transition-colors hover:bg-accent/10 hover:text-text disabled:opacity-50"
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
						class="flex w-full items-center justify-center gap-1.5 whitespace-nowrap py-2.5 font-mono text-[10px] tracking-[0.15em] uppercase text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
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
	<div class="border border-red-900/40 bg-red-950/10">
		<div class="aspect-square flex flex-col items-center justify-center gap-3 px-6">
			<svg class="h-6 w-6 text-red-500/60" viewBox="0 0 24 24" fill="none">
				<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" />
				<path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
			<MonoLabel class="text-red-500/60">Generation failed</MonoLabel>
			{#if error}
				<p class="max-w-[200px] text-center text-xs text-dim">{error}</p>
			{/if}
		</div>
		<div class="border-t border-red-900/20 px-4 py-3">
			<p class="line-clamp-1 text-xs text-dim">{prompt}</p>
		</div>
	</div>
{/if}
