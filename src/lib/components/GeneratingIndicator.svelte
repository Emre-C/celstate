<script lang="ts">
	let { prompt }: { prompt: string } = $props();
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
		<p class="max-w-xs truncate text-center text-xs text-dim">
			{prompt}
		</p>
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
