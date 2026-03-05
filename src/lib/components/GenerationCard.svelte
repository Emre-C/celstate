<script lang="ts">
	import CheckerboardPreview from './CheckerboardPreview.svelte';
	import GeneratingIndicator from './GeneratingIndicator.svelte';

	let {
		prompt,
		status,
		resultUrl,
		error,
		createdAt,
		completedAt,
		generationTimeMs
	}: {
		prompt: string;
		status: 'generating' | 'complete' | 'failed';
		resultUrl?: string;
		error?: string;
		createdAt: number;
		completedAt?: number;
		generationTimeMs?: number;
	} = $props();

	let downloading = $state(false);

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

	async function handleDownload() {
		if (!resultUrl || downloading) return;
		downloading = true;
		try {
			const response = await fetch(resultUrl);
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			const safeName = prompt
				.toLowerCase()
				.replace(/[^a-z0-9\s]/g, '')
				.replace(/\s+/g, '-')
				.slice(0, 40);
			a.download = `celstate-${safeName}.png`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} finally {
			downloading = false;
		}
	}
</script>

{#if status === 'generating'}
	<div class="border border-border">
		<div class="aspect-square flex items-center justify-center bg-bg">
			<GeneratingIndicator {prompt} />
		</div>
		<div class="border-t border-border px-4 py-3">
			<p class="line-clamp-1 text-xs text-dim">{prompt}</p>
		</div>
	</div>
{:else if status === 'complete' && resultUrl}
	<div class="group border border-border transition-colors hover:border-accent/20">
		<CheckerboardPreview src={resultUrl} alt={prompt} class="aspect-square" />
		<div class="border-t border-border px-4 py-3">
			<p class="mb-3 line-clamp-2 text-sm text-dim">{prompt}</p>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					{#if generationTimeMs}
						<span class="font-mono text-[10px] tracking-[0.15em] uppercase text-dim">
							{formatTime(generationTimeMs)}
						</span>
					{/if}
					<span class="font-mono text-[10px] tracking-[0.15em] uppercase text-dim">
						{formatTimeAgo(createdAt)}
					</span>
				</div>
				<button
					onclick={handleDownload}
					disabled={downloading}
					class="flex items-center gap-1.5 border border-accent px-3 py-1.5 font-mono text-[10px] tracking-[0.15em] uppercase text-accent transition-colors hover:bg-accent hover:text-bg disabled:opacity-50"
				>
					<svg class="h-3 w-3" viewBox="0 0 12 12" fill="none">
						<path d="M6 1v7M3 6l3 3 3-3M2 10h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					{downloading ? 'Saving...' : 'Download'}
				</button>
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
			<span class="font-mono text-[10px] tracking-[0.15em] uppercase text-red-500/60">
				Generation failed
			</span>
			{#if error}
				<p class="max-w-[200px] text-center text-xs text-dim">{error}</p>
			{/if}
		</div>
		<div class="border-t border-red-900/20 px-4 py-3">
			<p class="line-clamp-1 text-xs text-dim">{prompt}</p>
		</div>
	</div>
{/if}
