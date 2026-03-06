<script lang="ts">
	let {
		prompt,
		statusMessage,
		createdAt
	}: {
		prompt: string;
		statusMessage?: string;
		createdAt: number;
	} = $props();

	let elapsed = $state(0);

	$effect(() => {
		const start = createdAt;
		const tick = () => {
			elapsed = Math.floor((Date.now() - start) / 1000);
		};
		tick();
		const interval = setInterval(tick, 1000);
		return () => clearInterval(interval);
	});

	const elapsedDisplay = $derived(
		elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
	);
</script>

<div class="flex flex-col items-center gap-4 py-8">
	<!-- Pixel grid scanner -->
	<div class="grid-scanner" aria-hidden="true">
		{#each Array(48) as _, i}
			<div
				class="scanner-cell"
				style="animation-delay: {(Math.floor(i / 8) + (i % 8)) * 80}ms"
			></div>
		{/each}
	</div>

	<!-- Status text -->
	<div class="flex flex-col items-center gap-1.5">
		<span class="generating-text font-mono text-[11px] tracking-[0.2em] uppercase text-accent">
			Generating
		</span>
		{#if statusMessage}
			<p class="text-center text-xs text-dim">{statusMessage}</p>
		{/if}
		<p class="max-w-xs truncate text-center text-xs text-dim/50">
			{prompt}
		</p>
		<span class="font-mono text-[10px] tracking-[0.15em] text-dim/40">
			{elapsedDisplay}
		</span>
	</div>
</div>

<style>
	.grid-scanner {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 2px;
		width: 74px;
	}

	.scanner-cell {
		width: 7px;
		height: 7px;
		background-color: var(--color-border);
		animation: scanner-pulse 2s ease-in-out infinite;
	}

	@keyframes scanner-pulse {
		0%, 100% {
			background-color: var(--color-border);
		}
		40%, 60% {
			background-color: var(--color-accent);
			box-shadow: 0 0 4px var(--color-accent);
		}
	}

	.generating-text::after {
		content: '';
		animation: ellipsis 1.5s steps(4, end) infinite;
	}

	@keyframes ellipsis {
		0% { content: ''; }
		25% { content: '.'; }
		50% { content: '..'; }
		75% { content: '...'; }
	}
</style>
