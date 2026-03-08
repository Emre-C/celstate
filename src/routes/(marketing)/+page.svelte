<script lang="ts">
	import HeroShowcase from '$lib/components/HeroShowcase.svelte';
	import Logo from '$lib/components/Logo.svelte';

	const features = [
		{
			title: 'Native Transparency',
			description: 'Generated with alpha from the start. No background removal step, no edge degradation.',
			stat: 'Zero-step'
		},
		{
			title: 'Clean Edges',
			description: 'No halos, no color bleed, no fringing. Edges that hold up on any background.',
			stat: 'Pixel-perfect'
		},
		{
			title: 'Production Ready',
			description: '32-bit RGBA PNGs with a proper alpha channel. Drop into any project immediately.',
			stat: 'Ship-ready'
		},
		{
			title: 'Any Subject',
			description: 'Logos, characters, product shots, icons, stickers — if you can describe it, we generate it.',
			stat: 'Unlimited'
		},
		{
			title: 'Instant Results',
			description: 'Type a prompt, get your image. No queues, no waiting, no multi-step workflows.',
			stat: '<2 seconds'
		},
		{
			title: 'Simple Pricing',
			description: 'Credits in $10 packs. No subscriptions, no tiers, no expiration. Use when you need them.',
			stat: 'Pay-as-you-go'
		}
	];
</script>

<div class="min-h-dvh">
	<!-- Nav -->
	<nav class="fixed top-0 left-0 right-0 z-50 border-b border-border bg-bg/80 backdrop-blur-md">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:px-16 md:px-24 lg:px-32">
			<a href="/" class="flex items-center gap-2.5 text-text transition-colors hover:text-accent">
				<Logo class="h-6 w-6" />
				<span class="text-lg font-light tracking-tight">celstate</span>
			</a>
			<a
				href="/app"
				class="border border-accent bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-bg"
			>
				Start Generating
			</a>
		</div>
	</nav>

	<!-- Hero: Split layout — editorial left, interactive proof right -->
	<section class="px-6 pt-28 pb-20 sm:px-16 md:px-24 lg:px-32">
		<div class="mx-auto grid max-w-6xl items-start gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
			<!-- Left: editorial -->
			<div class="pt-4 lg:pt-8">
				<p class="mb-6 font-mono text-xs tracking-[0.15em] uppercase text-dim">
					<span class="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent"></span>
					Transparent background generation
				</p>
				<h1 class="mb-6 text-4xl font-light leading-[1.1] tracking-tight text-text sm:text-5xl">
					Images with nothing behind them.
				</h1>
				<p class="mb-10 max-w-md text-sm leading-relaxed text-dim">
					Type what you need. Get a production-ready PNG with a transparent background.
					No background removal. No artifacts. Just the subject, clean and isolated.
				</p>
				<div class="flex items-center gap-4">
					<a
						href="/app"
						class="border border-accent bg-accent px-6 py-2.5 text-sm font-medium text-bg transition-colors hover:bg-accent/90"
					>
						Start Generating
					</a>
				</div>
			</div>

			<!-- Right: interactive showcase -->
			<div>
				<HeroShowcase />
			</div>
		</div>
	</section>

	<!-- Features: Bento grid -->
	<section id="features" class="border-t border-border px-6 py-20 sm:px-16 md:px-24 lg:px-32">
		<div class="mx-auto max-w-6xl">
			<div class="mb-12 max-w-xl">
				<p class="mb-6 font-mono text-xs tracking-[0.15em] uppercase text-dim">
					<span class="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent"></span>
					Why it matters
				</p>
				<h2 class="text-2xl font-light tracking-tight text-text">
					Details that make the difference.
				</h2>
			</div>

			<div class="grid grid-cols-1 border-t border-l border-border sm:grid-cols-2 lg:grid-cols-3">
				{#each features as feature}
					<div class="group border-r border-b border-border p-6 transition-colors hover:bg-accent/[0.02] sm:p-8">
						<span class="mb-4 block font-mono text-[10px] tracking-[0.2em] uppercase text-accent">
							{feature.stat}
						</span>
						<h3 class="mb-2 text-sm font-medium text-text">
							{feature.title}
						</h3>
						<p class="text-sm leading-relaxed text-dim">
							{feature.description}
						</p>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- How it Works -->
	<section class="border-t border-border px-6 py-20 sm:px-16 md:px-24 lg:px-32">
		<div class="mx-auto max-w-6xl">
			<div class="mb-12 max-w-xl">
				<p class="mb-6 font-mono text-xs tracking-[0.15em] uppercase text-dim">
					<span class="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent"></span>
					How it works
				</p>
				<h2 class="text-2xl font-light tracking-tight text-text">
					Three steps. No learning curve.
				</h2>
			</div>

			<div class="grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-3">
				<div class="bg-bg p-6 sm:p-8">
					<span class="mb-4 block font-mono text-xs tracking-[0.15em] text-accent">01</span>
					<h3 class="mb-2 text-sm font-medium text-text">Describe</h3>
					<p class="text-sm leading-relaxed text-dim">
						Type what you need. A logo, a character sprite, a product shot — plain language, no prompt engineering.
					</p>
				</div>
				<div class="bg-bg p-6 sm:p-8">
					<span class="mb-4 block font-mono text-xs tracking-[0.15em] text-accent">02</span>
					<h3 class="mb-2 text-sm font-medium text-text">Generate</h3>
					<p class="text-sm leading-relaxed text-dim">
						Hit enter. Celstate generates the image natively on a transparent background in under two seconds.
					</p>
				</div>
				<div class="bg-bg p-6 sm:p-8">
					<span class="mb-4 block font-mono text-xs tracking-[0.15em] text-accent">03</span>
					<h3 class="mb-2 text-sm font-medium text-text">Download</h3>
					<p class="text-sm leading-relaxed text-dim">
						Preview your result. Download a production-ready 32-bit PNG with a proper alpha channel. Done.
					</p>
				</div>
			</div>
		</div>
	</section>

	<!-- Pricing -->
	<section class="border-t border-border px-6 py-20 sm:px-16 md:px-24 lg:px-32">
		<div class="mx-auto max-w-6xl">
			<div class="mb-12 max-w-xl">
				<p class="mb-6 font-mono text-xs tracking-[0.15em] uppercase text-dim">
					<span class="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent"></span>
					Pricing
				</p>
				<h2 class="mb-4 text-2xl font-light tracking-tight text-text">
					Credits. No subscriptions.
				</h2>
				<p class="text-sm leading-relaxed text-dim">
					Buy credits in $10 increments. Use them when you need them.
					No monthly fees. No tiers. No expiration.
				</p>
			</div>

			<div class="max-w-xs border border-border p-6">
				<div class="mb-4 flex items-baseline gap-1">
					<span class="text-3xl font-light text-text">$10</span>
					<span class="text-sm text-dim">/ credit pack</span>
				</div>
				<ul class="mb-6 space-y-2.5">
					<li class="flex items-start gap-2 text-sm text-dim">
						<span class="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-accent"></span>
						Pay as you go
					</li>
					<li class="flex items-start gap-2 text-sm text-dim">
						<span class="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-accent"></span>
						Credits never expire
					</li>
					<li class="flex items-start gap-2 text-sm text-dim">
						<span class="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-accent"></span>
						30-day image history
					</li>
					<li class="flex items-start gap-2 text-sm text-dim">
						<span class="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-accent"></span>
						Production-ready PNGs
					</li>
				</ul>
				<a
					href="/app"
					class="block w-full border border-accent bg-accent py-2.5 text-center text-sm font-medium text-bg transition-colors hover:bg-accent/90"
				>
					Start Generating
				</a>
			</div>
		</div>
	</section>

	<!-- Footer -->
	<footer class="border-t border-border px-6 py-10 sm:px-16 md:px-24 lg:px-32">
		<div class="mx-auto flex max-w-6xl items-center justify-between">
			<span class="text-sm text-dim">© {new Date().getFullYear()} Celstate</span>
			<span class="text-sm text-dim">Transparent images. Nothing else.</span>
		</div>
	</footer>
</div>
