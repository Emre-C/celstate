<script lang="ts">
	import { onMount } from 'svelte';

	interface BackgroundOption {
		label: string;
		class: string;
	}

	interface ImageOption {
		src: string;
		alt: string;
		label: string;
	}

	const backgrounds: BackgroundOption[] = [
		{ label: 'Transparent', class: 'showcase-checker' },
		{ label: 'White', class: 'bg-white' },
		{ label: 'Dark', class: 'bg-[#0f172a]' },
		{ label: 'Terracotta', class: 'bg-gradient-to-br from-orange-900 to-amber-700' },
		{ label: 'Mesh', class: 'showcase-mesh' }
	];

	const images: ImageOption[] = [
		{ src: '/images/celstate-a-majestic-phoenix-bird-in-midflight-win.png', alt: 'Phoenix with glowing wisps and semi-transparent flame edges', label: 'Phoenix' },
		{ src: '/images/celstate-an-exploding-wooden-statue-thats-signifi.png', alt: 'Wooden deity disintegrating in an explosion of splinters, pagodas, and dragon heads on a transparent background', label: 'Statue' }
	];

	let selectedBg = $state(0);
	let selectedImage = $state(0);
	let userHasInteracted = $state(false);
	let autoCycling = $state(false);

	const autoCycleSequence = [1, 2, 3, 4, 0];

	function selectBackground(i: number) {
		userHasInteracted = true;
		autoCycling = false;
		selectedBg = i;
	}

	onMount(() => {
		if (userHasInteracted) return;

		let step = 0;
		let timeoutId: ReturnType<typeof setTimeout>;

		timeoutId = setTimeout(() => {
			autoCycling = true;

			function nextStep() {
				if (userHasInteracted || step >= autoCycleSequence.length) {
					autoCycling = false;
					return;
				}
				selectedBg = autoCycleSequence[step];
				step++;
				timeoutId = setTimeout(nextStep, 1400);
			}

			nextStep();
		}, 1800);

		return () => clearTimeout(timeoutId);
	});
</script>

<div class="showcase-wrapper min-w-0 max-w-full">
	<div class="mb-3 flex flex-wrap items-center gap-1.5">
		<span
			class="mr-2 text-[10px] font-medium tracking-[0.06em] uppercase text-dim"
		>Background</span>
		{#each backgrounds as bg, i}
			<button
				onclick={() => selectBackground(i)}
				class="showcase-bg-btn border px-2.5 py-1 text-[10px] font-medium tracking-wide uppercase transition-all duration-200 {selectedBg === i
					? 'border-accent/60 bg-accent/10 text-accent'
					: 'border-border text-dim hover:border-accent/30 hover:text-text'} {autoCycling && selectedBg === i ? 'showcase-active-sweep' : ''}"
			>
				{bg.label}
			</button>
		{/each}
	</div>

	<div class="relative overflow-hidden border border-border">
		<div
			class="aspect-[4/3] transition-all duration-700 ease-[cubic-bezier(0.25,1,0.5,1)] {backgrounds[selectedBg].class}"
		>
			<img
				src={images[selectedImage].src}
				alt={images[selectedImage].alt}
				class="h-full w-full object-contain p-6 transition-opacity duration-300"
				fetchpriority={selectedImage === 0 ? 'high' : 'auto'}
				decoding="async"
			/>
		</div>

		<div
			class="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-border bg-bg px-4 py-2.5"
		>
			<div class="flex items-center gap-1">
				{#each images as img, i}
					<button
						onclick={() => { selectedImage = i; userHasInteracted = true; }}
						class="px-2.5 py-1 text-[10px] font-medium tracking-wide uppercase transition-all duration-200 {selectedImage === i
							? 'text-accent'
							: 'text-dim hover:text-text'}"
					>
						{img.label}
					</button>
				{/each}
			</div>

			<span class="text-[10px] font-medium tracking-wide uppercase text-dim">
				PNG · 32-bit RGBA
			</span>
		</div>
	</div>

	<div class="mt-3 flex items-center gap-5 text-[10px] font-medium uppercase tracking-wide text-dim">
		<span>0 halos</span>
		<span>Edge-true</span>
		<span>&lt;2s</span>
	</div>
</div>

<style>
	.showcase-active-sweep {
		animation: showcase-sweep 600ms cubic-bezier(0.25, 1, 0.5, 1) forwards;
	}

	@keyframes showcase-sweep {
		0% {
			border-color: var(--color-border);
			background-color: transparent;
			color: var(--color-dim);
		}
		40% {
			border-color: var(--color-accent);
			background-color: oklch(from var(--color-accent) l c h / 0.15);
			color: var(--color-accent);
		}
		100% {
			border-color: oklch(from var(--color-accent) l c h / 0.6);
			background-color: oklch(from var(--color-accent) l c h / 0.1);
			color: var(--color-accent);
		}
	}

	.showcase-checker {
		background-image: linear-gradient(45deg, #d6d3cb 25%, transparent 25%),
			linear-gradient(-45deg, #d6d3cb 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #d6d3cb 75%),
			linear-gradient(-45deg, transparent 75%, #d6d3cb 75%);
		background-size: 20px 20px;
		background-position:
			0 0,
			0 10px,
			10px -10px,
			-10px 0;
		background-color: #e8e5dd;
	}

	.showcase-mesh {
		background: linear-gradient(135deg, #92400e 0%, #b45309 25%, #d97706 50%, #f59e0b 75%, #fbbf24 100%);
	}

	@media (prefers-reduced-motion: reduce) {
		.showcase-active-sweep {
			animation: none;
		}
	}
</style>
