<script lang="ts">
	import { browser } from '$app/environment';
	import type { AnimationItem } from 'lottie-web';

	let {
		label,
		src
	}: {
		label: string;
		src?: string | null;
	} = $props();

	let container = $state<HTMLDivElement>();
	let errorMessage = $state('');
	let loading = $state(false);

	$effect(() => {
		if (!browser || !container || !src) {
			return;
		}

		let cancelled = false;
		let animation: AnimationItem | undefined;
		loading = true;
		errorMessage = '';
		container.innerHTML = '';

		const load = async () => {
			try {
				const [{ default: lottie }, response] = await Promise.all([
					import('lottie-web'),
					fetch(src)
				]);
				if (!response.ok) {
					throw new Error(`Preview failed with ${response.status}`);
				}

				const animationData = (await response.json()) as unknown;
				if (cancelled || !container) {
					return;
				}

				const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
				animation = lottie.loadAnimation({
					animationData,
					autoplay: !reduceMotion,
					container,
					loop: !reduceMotion,
					renderer: 'svg',
					rendererSettings: {
						preserveAspectRatio: 'xMidYMid meet'
					}
				});
				if (reduceMotion) {
					animation.goToAndStop(0, true);
				}
			} catch (error) {
				if (!cancelled) {
					errorMessage = error instanceof Error ? error.message : 'Preview failed.';
				}
			} finally {
				if (!cancelled) {
					loading = false;
				}
			}
		};

		void load();

		return () => {
			cancelled = true;
			animation?.destroy();
			if (container) {
				container.innerHTML = '';
			}
		};
	});
</script>

<div class="checkerboard-bg relative flex aspect-video items-center justify-center overflow-hidden">
	{#if src}
		<div bind:this={container} class="h-full w-full" aria-label={label}></div>
		{#if loading}
			<span class="absolute text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
				Loading preview
			</span>
		{/if}
		{#if errorMessage}
			<div class="absolute max-w-56 px-4 text-center text-xs text-red-700">
				{errorMessage}
			</div>
		{/if}
	{:else}
		<span class="text-[10px] font-medium tracking-[0.06em] text-dim uppercase">
			No preview
		</span>
	{/if}
</div>
