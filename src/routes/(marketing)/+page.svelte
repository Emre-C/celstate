<script lang="ts">
	import HeroShowcase from '$lib/components/HeroShowcase.svelte';
	import NavBar from '$lib/components/ui/NavBar.svelte';
	import PageContainer from '$lib/components/ui/PageContainer.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';

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
			description: 'Start free, buy credit packs when you need more. No subscriptions, no expiration.',
			stat: 'Pay-as-you-go'
		}
	];
</script>

<div class="min-h-dvh">
	<!-- Nav -->
	<NavBar>
		<a
			href="/app"
			class="border border-accent bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-bg"
		>
			Start Generating
		</a>
	</NavBar>

	<!-- Hero: Split layout — editorial left, interactive proof right -->
	<section class="pt-28 pb-20">
		<PageContainer>
			<div class="grid items-start gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
				<!-- Left: editorial -->
				<div class="pt-4 lg:pt-8">
					<div class="mb-6">
						<SectionLabel text="Transparent background generation" />
					</div>
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
		</PageContainer>
	</section>

	<!-- Features: Bento grid -->
	<section id="features" class="border-t border-border py-20">
		<PageContainer>
			<div class="mb-12 max-w-xl">
				<div class="mb-6">
					<SectionLabel text="Why it matters" />
				</div>
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
		</PageContainer>
	</section>

	<!-- How it Works -->
	<section class="border-t border-border py-20">
		<PageContainer>
			<div class="mb-12 max-w-xl">
				<div class="mb-6">
					<SectionLabel text="How it works" />
				</div>
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
		</PageContainer>
	</section>

	<!-- Pricing -->
	<section class="border-t border-border py-20">
		<PageContainer>
			<div class="mb-12 max-w-xl">
				<div class="mb-6">
					<SectionLabel text="Pricing" />
				</div>
				<h2 class="text-2xl font-light tracking-tight text-text">
					Pay for what you use.
				</h2>
			</div>

			<div class="grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-3">
				<div class="flex flex-col bg-bg p-6 sm:p-8">
					<span class="mb-6 block font-mono text-[10px] tracking-[0.2em] uppercase text-accent">Free</span>
					<span class="mb-2 block text-3xl font-light text-text">$0</span>
					<p class="mb-8 flex-1 text-sm leading-relaxed text-dim">
						3 credits on sign-up, plus 1 free credit every week. Enough to try it — not enough to rely on it.
					</p>
					<a
						href="/app"
						class="block w-full border border-border py-2.5 text-center text-sm text-dim transition-colors hover:border-accent hover:text-text"
					>
						Start Free
					</a>
				</div>
				<div class="flex flex-col bg-bg p-6 sm:p-8">
					<span class="mb-6 block font-mono text-[10px] tracking-[0.2em] uppercase text-accent">Starter</span>
					<span class="mb-2 block text-3xl font-light text-text">$5</span>
					<p class="mb-8 flex-1 text-sm leading-relaxed text-dim">
						15 credits, one-time. No subscription.
						Your free weekly drip continues on top.
					</p>
					<a
						href="/app"
						class="block w-full border border-accent bg-accent/10 py-2.5 text-center text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-bg"
					>
						Get Started
					</a>
				</div>
				<div class="flex flex-col bg-bg p-6 sm:p-8">
					<div class="mb-6 flex items-center gap-3">
						<span class="font-mono text-[10px] tracking-[0.2em] uppercase text-accent">Pro</span>
						<span class="font-mono text-[10px] tracking-[0.15em] uppercase text-accent/60">Best value</span>
					</div>
					<span class="mb-2 block text-3xl font-light text-text">$10</span>
					<p class="mb-8 flex-1 text-sm leading-relaxed text-dim">
						40 credits at $0.25 each — 25% less than Starter.
						Same deal: one-time, no subscription, weekly drip continues.
					</p>
					<a
						href="/app"
						class="block w-full border border-accent bg-accent py-2.5 text-center text-sm font-medium text-bg transition-colors hover:bg-accent/90"
					>
						Get Pro
					</a>
				</div>
			</div>

			<p class="mt-6 text-sm text-dim">
				Credits never expire. Buy more packs whenever you need them.
			</p>
		</PageContainer>
	</section>

	<!-- Footer -->
	<footer class="border-t border-border py-10">
		<PageContainer>
			<div class="flex items-center justify-between">
				<span class="text-sm text-dim">© {new Date().getFullYear()} Celstate</span>
				<span class="text-sm text-dim">Transparent images. Nothing else.</span>
			</div>
		</PageContainer>
	</footer>
</div>
