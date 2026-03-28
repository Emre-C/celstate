<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { PUBLIC_SITE_URL } from '$env/static/public';
	import { growthEvents } from '$lib/analytics/growth-events.js';
	import { initPostHog, posthog } from '$lib/posthog';
	import HeroShowcase from '$lib/components/HeroShowcase.svelte';
	import ZoomInspector from '$lib/components/ZoomInspector.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import NavBar from '$lib/components/ui/NavBar.svelte';
	import PageContainer from '$lib/components/ui/PageContainer.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';

	const heroImageSrc = '/images/celstate-a-majestic-phoenix-bird-in-midflight-win.png';

	const siteOrigin = PUBLIC_SITE_URL.replace(/\/$/, '');
	const canonicalUrl = `${siteOrigin}/`;
	const ogImageUrl = `${siteOrigin}${heroImageSrc}`;
	const pageTitle = 'AI transparent PNG generator — Celstate';
	const pageDescription =
		'Generate transparent PNGs from text with a real alpha channel — no background removal, no halos. AI image generation for logos, characters, and product shots.';
	const jsonLd = JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'SoftwareApplication',
		name: 'Celstate',
		applicationCategory: 'DesignApplication',
		operatingSystem: 'Web',
		description: pageDescription,
		offers: {
			'@type': 'Offer',
			price: '0',
			priceCurrency: 'USD'
		},
		url: canonicalUrl
	}).replace(/</g, '\\u003c');

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

	onMount(() => {
		if (!browser) {
			return;
		}
		if (!initPostHog()) {
			return;
		}
		posthog.capture(growthEvents.landingViewed, { pathname: '/' });
	});

	function captureLandingCta(ctaId: string) {
		if (!browser) {
			return;
		}
		if (!initPostHog()) {
			return;
		}
		posthog.capture(growthEvents.landingCtaClicked, { cta_id: ctaId, destination: '/app' });
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDescription} />
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Celstate" />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDescription} />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:image" content={ogImageUrl} />
	<meta property="og:image:alt" content="Celstate sample — phoenix artwork with transparent background" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={pageDescription} />
	<meta name="twitter:image" content={ogImageUrl} />
	<link rel="preload" as="image" href={heroImageSrc} />
	{@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<div class="min-h-dvh">
	<!-- Nav -->
	<NavBar>
		<Button href="/app" class="px-4 py-1.5" onclick={() => captureLandingCta('nav_start')}>
			Start Generating
		</Button>
	</NavBar>

	<!-- Hero: Split layout — editorial left, interactive proof right -->
	<section class="pt-24 pb-16 sm:pt-28 sm:pb-20 lg:pt-32 lg:pb-24">
		<PageContainer>
			<div class="grid items-start gap-10 sm:gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
				<!-- Left: editorial -->
				<div class="hero-stagger min-w-0 pt-4 lg:pt-8">
					<div class="hero-item mb-4">
						<SectionLabel text="AI transparent PNG generator" />
					</div>
					<h1
						class="hero-item mb-6 text-4xl font-display italic leading-[1.12] tracking-tight text-balance text-text sm:text-5xl sm:leading-[1.1] lg:text-6xl"
					>
						Describe it. Generate&nbsp;it.<br />
						Already transparent.
					</h1>
					<p class="hero-item mb-10 max-w-md break-words text-sm leading-relaxed text-dim">
						Imagine any image — a logo, a character, a product shot — and Celstate generates it
						in seconds, already on a transparent background. No background removal step.
						No halos or artifacts. Just your vision, clean and ready to use.
					</p>
					<div class="hero-item flex items-center gap-4">
						<Button href="/app" class="px-7" onclick={() => captureLandingCta('hero_start')}>
							Start Generating
						</Button>
					</div>
				</div>

				<!-- Right: interactive showcase -->
				<div class="hero-item min-w-0 max-w-full" style="--hero-delay: 4">
					<HeroShowcase />
				</div>
			</div>
		</PageContainer>
	</section>

	<!-- Edge Quality: Zoom inspector -->
	<section class="border-t border-border py-24">
		<PageContainer>
			<div class="mb-10 max-w-xl min-w-0">
				<div class="mb-4">
					<SectionLabel text="Edge quality" />
				</div>
				<h2 class="mb-3 text-2xl font-display italic tracking-tight text-balance text-text">
					See what others blur.
				</h2>
				<p class="break-words text-sm leading-relaxed text-dim">
					Flame wisps, wood splinters, dust particles — Celstate preserves every semi-transparent edge. Hover to zoom in and inspect the alpha channel yourself.
				</p>
			</div>

			<div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
				<ZoomInspector
					src="/images/celstate-a-majestic-phoenix-bird-in-midflight-win.png"
					alt="Phoenix with transparent flame wisps and spark particles"
					label="Flame wisps & spark particles"
					focusPoint={{ x: 0.75, y: 0.2 }}
					lazy
				/>
				<ZoomInspector
					src="/images/celstate-an-exploding-wooden-statue-thats-signifi.png"
					alt="Exploding wooden statue with splinters and dust on transparent background"
					label="Wood splinters & dust particles"
					focusPoint={{ x: 0.3, y: 0.25 }}
					lazy
				/>
			</div>
		</PageContainer>
	</section>

	<!-- Features: Bento grid -->
	<section id="features" class="border-t border-border py-16">
		<PageContainer>
			<div class="mb-10 max-w-xl min-w-0">
				<div class="mb-4">
					<SectionLabel text="Why it matters" />
				</div>
				<h2 class="text-2xl font-display italic tracking-tight text-balance text-text">
					Details that make the difference.
				</h2>
			</div>

			<div class="grid grid-cols-1 gap-x-16 gap-y-10 sm:grid-cols-2">
				{#each features as feature}
					<div class="min-w-0">
						<h3 class="mb-1.5 text-sm font-semibold text-text">
							{feature.title}
						</h3>
						<p class="break-words text-sm leading-relaxed text-dim">
							{feature.description}
						</p>
					</div>
				{/each}
			</div>
		</PageContainer>
	</section>

	<!-- Pricing -->
	<section class="border-t border-border py-24">
		<PageContainer>
			<div class="mb-10 max-w-xl min-w-0">
				<div class="mb-4">
					<SectionLabel text="Pricing" />
				</div>
				<h2 class="text-2xl font-display italic tracking-tight text-balance text-text">
					Pay for what you use.
				</h2>
			</div>

			<div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
				<div class="flex flex-col border border-border p-6 sm:p-8">
					<span class="mb-6 block text-[11px] font-medium uppercase tracking-[0.08em] text-accent">Free</span>
					<span class="mb-2 block text-3xl font-display italic text-text">$0</span>
					<p class="mb-8 flex-1 break-words text-sm leading-relaxed text-dim">
						3 credits on sign-up, plus 1 free credit every week. Enough to try it — not enough to rely on it.
					</p>
					<Button href="/app" variant="ghost" fullWidth onclick={() => captureLandingCta('pricing_free')}>
						Start Free
					</Button>
				</div>
				<div class="flex flex-col border border-border p-6 sm:p-8">
					<span class="mb-6 block text-[11px] font-medium uppercase tracking-[0.08em] text-accent">Starter</span>
					<span class="mb-2 block text-3xl font-display italic text-text">$5</span>
					<p class="mb-8 flex-1 break-words text-sm leading-relaxed text-dim">
						15 credits, one-time. No subscription.
						Your free weekly drip continues on top.
					</p>
					<Button href="/app" variant="secondary" fullWidth onclick={() => captureLandingCta('pricing_starter')}>
						Get Started
					</Button>
				</div>
				<div class="flex flex-col border border-border p-6 sm:p-8">
					<div class="mb-6 flex items-center gap-3">
						<span class="text-[11px] font-medium uppercase tracking-[0.08em] text-accent">Pro</span>
						<span class="text-[11px] font-medium uppercase tracking-[0.08em] text-accent/60">Best value</span>
					</div>
					<span class="mb-2 block text-3xl font-display italic text-text">$10</span>
					<p class="mb-8 flex-1 break-words text-sm leading-relaxed text-dim">
						40 credits at $0.25 each — 25% less than Starter.
						Same deal: one-time, no subscription, weekly drip continues.
					</p>
					<Button href="/app" fullWidth onclick={() => captureLandingCta('pricing_pro')}>Get Pro</Button>
				</div>
			</div>

			<p class="mt-6 break-words text-sm text-dim">
				Credits never expire. Buy more packs whenever you need them.
			</p>
		</PageContainer>
	</section>

	<!-- Footer -->
	<footer class="border-t border-border py-10">
		<PageContainer>
			<div
				class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
			>
				<span class="text-sm text-dim">© {new Date().getFullYear()} Celstate</span>
				<span class="max-w-prose text-pretty text-sm text-dim sm:text-end">
					Transparent images. Nothing else.
				</span>
			</div>
		</PageContainer>
	</footer>
</div>

<style>
	.hero-stagger .hero-item {
		animation: hero-fade-in 0.7s cubic-bezier(0.25, 1, 0.5, 1) both;
	}

	.hero-stagger .hero-item:nth-child(1) { animation-delay: 0.1s; }
	.hero-stagger .hero-item:nth-child(2) { animation-delay: 0.2s; }
	.hero-stagger .hero-item:nth-child(3) { animation-delay: 0.3s; }
	.hero-stagger .hero-item:nth-child(4) { animation-delay: 0.4s; }

	.hero-item[style*="--hero-delay"] {
		animation: hero-fade-in 0.7s cubic-bezier(0.25, 1, 0.5, 1) both;
		animation-delay: 0.35s;
	}

	@keyframes hero-fade-in {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.hero-stagger .hero-item,
		.hero-item[style*="--hero-delay"] {
			animation: none;
		}
	}
</style>
