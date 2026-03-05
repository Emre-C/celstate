<script lang="ts">
	let {
		onsubmit,
		disabled = false,
		credits
	}: {
		onsubmit: (prompt: string) => void;
		disabled?: boolean;
		credits?: number;
	} = $props();

	let value = $state('');
	let focused = $state(false);

	function handleSubmit() {
		const trimmed = value.trim();
		if (!trimmed || disabled) return;
		onsubmit(trimmed);
		value = '';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	const noCredits = $derived(credits !== undefined && credits <= 0);
	const canSubmit = $derived(value.trim().length > 0 && !disabled && !noCredits);
</script>

<div class="prompt-input-wrapper">
	<div
		class="flex items-center border transition-all duration-200 {focused
			? 'border-accent/40 shadow-[0_0_12px_-4px_var(--color-accent)]'
			: 'border-border'}"
	>
		<!-- Terminal prompt indicator -->
		<div class="flex shrink-0 items-center px-4">
			<span class="font-mono text-sm text-accent" aria-hidden="true">&gt;_</span>
		</div>

		<!-- Input -->
		<input
			type="text"
			bind:value
			onkeydown={handleKeydown}
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			{disabled}
			placeholder={disabled ? 'Generating...' : 'Describe what you need — a logo, character, icon, sticker...'}
			class="min-w-0 flex-1 bg-transparent py-3.5 text-sm text-text outline-none placeholder:text-dim/60 disabled:opacity-50"
		/>

		<!-- Submit button -->
		<button
			onclick={handleSubmit}
			disabled={!canSubmit}
			class="flex shrink-0 items-center gap-2 border-l border-border px-5 py-3.5 font-mono text-[11px] tracking-[0.15em] uppercase transition-all duration-200
				{canSubmit
					? 'bg-accent/5 text-accent hover:bg-accent hover:text-bg'
					: 'text-dim/40 cursor-not-allowed'}"
		>
			{#if noCredits}
				No credits
			{:else if disabled}
				Working
			{:else}
				Generate
			{/if}
			<svg class="h-3 w-3" viewBox="0 0 12 12" fill="none">
				<path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</button>
	</div>

	<!-- Helper text -->
	<div class="mt-2 flex items-center justify-between px-1">
		<span class="font-mono text-[10px] tracking-[0.15em] uppercase text-dim/50">
			1 credit per generation
		</span>
		<span class="font-mono text-[10px] tracking-[0.15em] uppercase text-dim/50">
			Enter ↵ to generate
		</span>
	</div>
</div>
