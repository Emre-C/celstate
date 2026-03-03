<script lang="ts">
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
		{ label: 'White', class: 'bg-white' },
		{ label: 'Dark', class: 'bg-[#0f172a]' },
		{ label: 'Emerald', class: 'bg-gradient-to-br from-emerald-900 to-emerald-600' },
		{ label: 'Checker', class: 'showcase-checker' },
		{ label: 'Mesh', class: 'showcase-mesh' }
	];

	const images: ImageOption[] = [
		{ src: '/images/dog.png', alt: 'Game character with transparent background', label: 'Character' },
		{ src: '/images/tank.png', alt: 'Vehicle asset with transparent background', label: 'Vehicle' }
	];

	let selectedBg = $state(2);
	let selectedImage = $state(0);
</script>

<div class="showcase-wrapper">
	<!-- Background switcher -->
	<div class="mb-3 flex flex-wrap items-center gap-1.5">
		<span class="mr-2 font-mono text-[10px] tracking-[0.15em] uppercase text-dim">Switch background</span>
		{#each backgrounds as bg, i}
			<button
				onclick={() => (selectedBg = i)}
				class="border px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase transition-all duration-200 {selectedBg === i
					? 'border-accent/60 bg-accent/10 text-accent'
					: 'border-border text-dim hover:border-accent/30 hover:text-text'}"
			>
				{bg.label}
			</button>
		{/each}
	</div>

	<!-- Showcase stage -->
	<div class="relative overflow-hidden border border-border">
		<!-- Background layer -->
		<div
			class="aspect-[4/3] transition-all duration-500 ease-out {backgrounds[selectedBg].class}"
		>
			<!-- Image -->
			<img
				src={images[selectedImage].src}
				alt={images[selectedImage].alt}
				class="h-full w-full object-contain p-6 transition-opacity duration-300"
			/>
		</div>

		<!-- Bottom bar -->
		<div
			class="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-white/10 bg-bg/80 px-4 py-2.5 backdrop-blur-sm"
		>
			<!-- Image tabs -->
			<div class="flex items-center gap-1">
				{#each images as img, i}
					<button
						onclick={() => (selectedImage = i)}
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
</style>
