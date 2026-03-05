<script lang="ts">
	let { src, alt, class: className = '' }: { src: string; alt: string; class?: string } = $props();

	let loaded = $state(false);
</script>

<div class="checkerboard-preview relative overflow-hidden border border-border {className}">
	<!-- Checkerboard background -->
	<div class="checkerboard-bg absolute inset-0"></div>

	<!-- Image -->
	<img
		{src}
		{alt}
		class="relative h-full w-full object-contain p-4 transition-all duration-500 {loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}"
		onload={() => (loaded = true)}
	/>

	<!-- Corner brackets — targeting reticle aesthetic -->
	<svg class="pointer-events-none absolute top-2 left-2 h-4 w-4 text-accent/40" viewBox="0 0 16 16">
		<path d="M0 5V0H5" stroke="currentColor" stroke-width="1.5" fill="none" />
	</svg>
	<svg class="pointer-events-none absolute top-2 right-2 h-4 w-4 text-accent/40" viewBox="0 0 16 16">
		<path d="M16 5V0H11" stroke="currentColor" stroke-width="1.5" fill="none" />
	</svg>
	<svg class="pointer-events-none absolute bottom-2 left-2 h-4 w-4 text-accent/40" viewBox="0 0 16 16">
		<path d="M0 11V16H5" stroke="currentColor" stroke-width="1.5" fill="none" />
	</svg>
	<svg class="pointer-events-none absolute bottom-2 right-2 h-4 w-4 text-accent/40" viewBox="0 0 16 16">
		<path d="M16 11V16H11" stroke="currentColor" stroke-width="1.5" fill="none" />
	</svg>
</div>

<style>
	.checkerboard-bg {
		background-image:
			linear-gradient(45deg, #1a1a1a 25%, transparent 25%),
			linear-gradient(-45deg, #1a1a1a 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #1a1a1a 75%),
			linear-gradient(-45deg, transparent 75%, #1a1a1a 75%);
		background-size: 24px 24px;
		background-position: 0 0, 0 12px, 12px -12px, -12px 0;
		background-color: #111;
	}
</style>
