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
		{ label: 'Emerald', class: 'bg-gradient-to-br from-emerald-900 to-emerald-600' },
		{ label: 'Mesh', class: 'showcase-mesh' }
	];

	const images: ImageOption[] = [
		{ src: '/images/celstate-a-majestic-phoenix-bird-in-midflight-win.png', alt: 'Phoenix with glowing wisps and semi-transparent flame edges', label: 'Phoenix' },
		{ src: '/images/celstate-an-exploding-wooden-statue-thats-signifi.png', alt: 'Wooden deity disintegrating in an explosion of splinters, pagodas, and dragon heads on a transparent background', label: 'Statue' }
	];

	// Start on Transparent (checker) — index 0 now
	let selectedBg = $state(0);
	let selectedImage = $state(0);
	let userHasInteracted = $state(false);
	let autoCycling = $state(false);

	// Auto-cycle: white → dark → emerald → mesh → back to transparent (settle)
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

		// Start auto-cycling after 1.8s
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

<div class="showcase-wrapper">
	<!-- Background switcher -->
	<div class="mb-3 flex flex-wrap items-center gap-1.5">
		<span
			class="mr-2 font-mono text-[10px] tracking-[0.15em] uppercase text-dim"
		>Background</span>
		{#each backgrounds as bg, i}
			<button
				onclick={() => selectBackground(i)}
				class="showcase-bg-btn border px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase transition-all duration-200 {selectedBg === i
					? 'border-accent/60 bg-accent/10 text-accent'
					: 'border-border text-dim hover:border-accent/30 hover:text-text'} {autoCycling && selectedBg === i ? 'showcase-active-sweep' : ''}"
			>
				{bg.label}
			</button>
		{/each}
	</div>

	<!-- Showcase stage -->
	<div class="relative overflow-hidden border border-border">
		<!-- Background layer -->
		<div
			class="aspect-[4/3] transition-all duration-700 ease-[cubic-bezier(0.25,1,0.5,1)] {backgrounds[selectedBg].class}"
		>
			<!-- Image -->
			<img
				src={images[selectedImage].src}
				alt={images[selectedImage].alt}
				class="h-full w-full object-contain p-6 transition-opacity duration-300"
				fetchpriority={selectedImage === 0 ? 'high' : 'auto'}
				decoding="async"
			/>
		</div>

		<!-- Bottom bar -->
		<div
			class="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-white/10 bg-bg px-4 py-2.5"
		>
			<!-- Image tabs -->
			<div class="flex items-center gap-1">
				{#each images as img, i}
					<button
						onclick={() => { selectedImage = i; userHasInteracted = true; }}
						class="px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase transition-all duration-200 {selectedImage === i
							? 'text-accent'
							: 'text-dim hover:text-text'}"
					>
						{img.label}
					</button>
				{/each}
			</div>

			<!-- Format badge -->
			<span class="font-mono text-[10px] tracking-wider uppercase text-dim">
				PNG · 32-bit RGBA
			</span>
		</div>
	</div>

	<!-- Stats row -->
	<div class="mt-3 flex items-center gap-6">
		<div class="flex items-center gap-2">
			<span class="h-1.5 w-1.5 rounded-full bg-accent"></span>
			<span class="font-mono text-[10px] tracking-wider uppercase text-dim">0 halos</span>
		</div>
		<div class="flex items-center gap-2">
			<span class="h-1.5 w-1.5 rounded-full bg-accent"></span>
			<span class="font-mono text-[10px] tracking-wider uppercase text-dim">Edge-true</span>
		</div>
		<div class="flex items-center gap-2">
			<span class="h-1.5 w-1.5 rounded-full bg-accent"></span>
			<span class="font-mono text-[10px] tracking-wider uppercase text-dim">&lt;2s</span>
		</div>
	</div>
</div>

<style>
	/* Sweep highlight on the currently-active button during auto-cycle */
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
		background-image: linear-gradient(45deg, #1a1a1a 25%, transparent 25%),
			linear-gradient(-45deg, #1a1a1a 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #1a1a1a 75%),
			linear-gradient(-45deg, transparent 75%, #1a1a1a 75%);
		background-size: 20px 20px;
		background-position:
			0 0,
			0 10px,
			10px -10px,
			-10px 0;
		background-color: #111;
	}

	.showcase-mesh {
		background: linear-gradient(135deg, #1e1b4b 0%, #312e81 25%, #1e3a5f 50%, #0f172a 75%, #1a1a2e 100%);
	}

	@media (prefers-reduced-motion: reduce) {
		.showcase-active-sweep {
			animation: none;
		}
	}
</style>
