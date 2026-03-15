<script lang="ts">
	let {
		value = '1:1',
		onchange,
		disabled = false
	}: {
		value?: string;
		onchange: (ratio: string) => void;
		disabled?: boolean;
	} = $props();

	const commonRatios = [
		{ key: '1:1',  label: 'Square',     w: 1,  h: 1 },
		{ key: '4:3',  label: 'Landscape',  w: 4,  h: 3 },
		{ key: '3:4',  label: 'Portrait',   w: 3,  h: 4 },
		{ key: '16:9', label: 'Wide',       w: 16, h: 9 },
		{ key: '9:16', label: 'Tall',       w: 9,  h: 16 },
	];

	const moreRatios = [
		{ key: '3:2',  label: 'Photo',       w: 3,  h: 2 },
		{ key: '2:3',  label: 'Photo tall',  w: 2,  h: 3 },
		{ key: '5:4',  label: 'Print',       w: 5,  h: 4 },
		{ key: '4:5',  label: 'Social',      w: 4,  h: 5 },
		{ key: '21:9', label: 'Cinematic',   w: 21, h: 9 },
		{ key: '4:1',  label: 'Banner',      w: 4,  h: 1 },
		{ key: '1:4',  label: 'Tall banner', w: 1,  h: 4 },
		{ key: '8:1',  label: 'Strip',       w: 8,  h: 1 },
		{ key: '1:8',  label: 'Tall strip',  w: 1,  h: 8 },
	];

	let expanded = $state(false);
	const isMoreSelected = $derived(moreRatios.some((r) => r.key === value));

	/**
	 * Compute a proportional shape preview that fits within a 20×20 box.
	 * Returns CSS width/height in px for the shape swatch.
	 */
	function shapeStyle(w: number, h: number): string {
		const maxDim = 18;
		const scale = maxDim / Math.max(w, h);
		const pw = Math.max(4, Math.round(w * scale));
		const ph = Math.max(4, Math.round(h * scale));
		return `width:${pw}px;height:${ph}px`;
	}
</script>

<div class="flex flex-col gap-2">
	<!-- Common ratios -->
	<div class="flex flex-wrap items-center gap-1.5">
		{#each commonRatios as ratio (ratio.key)}
			<button
				type="button"
				onclick={() => onchange(ratio.key)}
				{disabled}
				class="group flex items-center gap-1.5 border px-2 py-1.5 transition-all duration-150
					{value === ratio.key
						? 'border-accent/60 bg-accent/10 text-accent'
						: 'border-border text-dim hover:border-accent/30 hover:text-text'}
					disabled:opacity-40 disabled:cursor-not-allowed"
				title={ratio.key}
			>
				<div
					class="shrink-0 rounded-[1px] transition-colors duration-150
						{value === ratio.key ? 'bg-accent' : 'bg-dim/40 group-hover:bg-dim/60'}"
					style={shapeStyle(ratio.w, ratio.h)}
				></div>
				<span class="font-mono text-[10px] leading-none tracking-[0.1em]">
					{ratio.label}
				</span>
			</button>
		{/each}

		<!-- More toggle -->
		<button
			type="button"
			onclick={() => (expanded = !expanded)}
			{disabled}
			class="flex items-center gap-1 border px-2 py-1.5 transition-all duration-150
				{isMoreSelected && !expanded
					? 'border-accent/40 text-accent'
					: 'border-border text-dim hover:border-accent/30 hover:text-text'}
				disabled:opacity-40 disabled:cursor-not-allowed"
		>
			<span class="font-mono text-[10px] leading-none tracking-[0.1em]">
				{expanded ? 'Less' : 'More'}
			</span>
			<svg
				class="h-2.5 w-2.5 transition-transform duration-200 {expanded ? 'rotate-180' : ''}"
				viewBox="0 0 10 10"
				fill="none"
			>
				<path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</button>
	</div>

	<!-- Expanded ratios -->
	{#if expanded}
		<div class="flex flex-wrap items-center gap-1.5">
			{#each moreRatios as ratio (ratio.key)}
				<button
					type="button"
					onclick={() => onchange(ratio.key)}
					{disabled}
					class="group flex items-center gap-1.5 border px-2 py-1.5 transition-all duration-150
						{value === ratio.key
							? 'border-accent/60 bg-accent/10 text-accent'
							: 'border-border text-dim hover:border-accent/30 hover:text-text'}
						disabled:opacity-40 disabled:cursor-not-allowed"
					title={ratio.key}
				>
					<div
						class="shrink-0 rounded-[1px] transition-colors duration-150
							{value === ratio.key ? 'bg-accent' : 'bg-dim/40 group-hover:bg-dim/60'}"
						style={shapeStyle(ratio.w, ratio.h)}
					></div>
					<span class="font-mono text-[10px] leading-none tracking-[0.1em]">
						{ratio.label}
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
