<script lang="ts">
	let {
		src,
		alt,
		label,
		zoomLevel = 3,
		loupeSize = 150,
		focusPoint = { x: 0.5, y: 0.3 },
		lazy = false
	}: {
		src: string;
		alt: string;
		label: string;
		zoomLevel?: number;
		loupeSize?: number;
		focusPoint?: { x: number; y: number };
		lazy?: boolean;
	} = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let hovering = $state(false);
	let mouseX = $state(0);
	let mouseY = $state(0);

	// Normalized cursor position within the image container (0–1)
	let normX = $derived(containerEl ? mouseX / containerEl.clientWidth : focusPoint.x);
	let normY = $derived(containerEl ? mouseY / containerEl.clientHeight : focusPoint.y);

	// Loupe CSS: zoomed image on checkerboard background
	let loupeStyle = $derived(() => {
		if (!containerEl) return '';
		const bgSize = containerEl.clientWidth * zoomLevel;
		const bgSizeY = containerEl.clientHeight * zoomLevel;
		const bgX = -(normX * bgSize - loupeSize / 2);
		const bgY = -(normY * bgSizeY - loupeSize / 2);
		return [
			`width: ${loupeSize}px`,
			`height: ${loupeSize}px`,
			`left: ${mouseX - loupeSize / 2}px`,
			`top: ${mouseY - loupeSize / 2}px`,
			`background-image: url('${src}')`,
			`background-size: ${bgSize}px ${bgSizeY}px`,
			`background-position: ${bgX}px ${bgY}px`,
			`background-repeat: no-repeat`,
			`background-color: #e8e5dd`
		].join(';');
	});

	function handleMouseMove(e: MouseEvent) {
		if (!containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		mouseX = e.clientX - rect.left;
		mouseY = e.clientY - rect.top;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!containerEl || !e.touches[0]) return;
		const rect = containerEl.getBoundingClientRect();
		mouseX = e.touches[0].clientX - rect.left;
		mouseY = e.touches[0].clientY - rect.top;
	}
</script>

<div class="flex flex-col gap-2">
	<!-- Image container with loupe -->
	<div
		bind:this={containerEl}
		class="zoom-inspector relative cursor-crosshair overflow-hidden border border-border zoom-checker-bg"
		onmouseenter={() => (hovering = true)}
		onmouseleave={() => (hovering = false)}
		onmousemove={handleMouseMove}
		ontouchstart={() => (hovering = true)}
		ontouchend={() => (hovering = false)}
		ontouchmove={handleTouchMove}
		role="img"
		aria-label="{alt} — hover to zoom"
	>
		<!-- Base image -->
		<img
			{src}
			{alt}
			class="relative aspect-square w-full object-contain p-4"
			loading={lazy ? 'lazy' : 'eager'}
			decoding="async"
			draggable="false"
		/>

		<!-- Magnifying loupe -->
		{#if hovering}
			<div
				class="zoom-loupe pointer-events-none absolute rounded-full border border-accent/60 shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_0_16px_rgba(0,0,0,0.12)]"
				style={loupeStyle()}
			>
				<!-- Center crosshair -->
				<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
					<div class="h-3 w-px bg-accent/50"></div>
				</div>
				<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
					<div class="h-px w-3 bg-accent/50"></div>
				</div>
			</div>
		{/if}

		<!-- Instruction hint -->
		<div
			class="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-[9px] font-medium tracking-wide uppercase transition-opacity duration-300 {hovering ? 'opacity-0' : 'opacity-100'}"
		>
			<span class="rounded-full border border-border bg-bg/80 px-2.5 py-1 text-dim backdrop-blur-sm">
				Hover to inspect
			</span>
		</div>
	</div>

	<!-- Label -->
	<span class="text-[10px] font-medium tracking-wide uppercase text-dim">
		{label}
	</span>
</div>

<style>
	.zoom-checker-bg {
		background-image:
			linear-gradient(45deg, #d6d3cb 25%, transparent 25%),
			linear-gradient(-45deg, #d6d3cb 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #d6d3cb 75%),
			linear-gradient(-45deg, transparent 75%, #d6d3cb 75%);
		background-size: 24px 24px;
		background-position: 0 0, 0 12px, 12px -12px, -12px 0;
		background-color: #e8e5dd;
	}

	.zoom-loupe {
		z-index: 10;
	}

	@media (prefers-reduced-motion: reduce) {
		.zoom-loupe {
			transition: none;
		}
	}
</style>
