<script lang="ts">
	import { browser } from '$app/environment';
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import {
		growthEvents,
		type CreditsPurchaseCtaSurface
	} from '$lib/analytics/growth-events.js';
	import { initPostHog, posthog } from '$lib/analytics/client-posthog';
	import AspectRatioSelector from './AspectRatioSelector.svelte';

	let {
		onsubmit,
		disabled = false,
		credits
	}: {
		onsubmit: (prompt: string, referenceStorageIds?: string[], aspectRatio?: string) => void;
		disabled?: boolean;
		credits?: number;
	} = $props();

	const client = useConvexClient();

	let value = $state('');
	let focused = $state(false);
	let referenceFiles = $state<File[]>([]);
	let referencePreviewUrls = $state<string[]>([]);
	let uploading = $state(false);
	let aspectRatio = $state('1:1');

	let fileInput: HTMLInputElement;

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) return;

		const remaining = 14 - referenceFiles.length;
		const newFiles = Array.from(files).slice(0, remaining);
		referenceFiles = [...referenceFiles, ...newFiles];
		referencePreviewUrls = [
			...referencePreviewUrls,
			...newFiles.map((f) => URL.createObjectURL(f)),
		];
		input.value = '';
	}

	function removeReference(index: number) {
		URL.revokeObjectURL(referencePreviewUrls[index]);
		referenceFiles = referenceFiles.filter((_, i) => i !== index);
		referencePreviewUrls = referencePreviewUrls.filter((_, i) => i !== index);
	}

	function clearAllReferences() {
		referencePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
		referenceFiles = [];
		referencePreviewUrls = [];
	}

	async function handleSubmit() {
		const trimmed = value.trim();
		if (!trimmed || disabled || uploading) return;

		const selectedRatio = aspectRatio === '1:1' ? undefined : aspectRatio;

		if (referenceFiles.length > 0) {
			uploading = true;
			try {
				const storageIds: string[] = [];
				for (const file of referenceFiles) {
					const uploadUrl = await client.mutation(api.generations.generateUploadUrl, {});
					const uploadResponse = await fetch(uploadUrl, {
						method: 'POST',
						headers: { 'Content-Type': file.type },
						body: file,
					});
					const { storageId } = await uploadResponse.json();
					storageIds.push(storageId);
				}
				value = '';
				clearAllReferences();
				onsubmit(trimmed, storageIds, selectedRatio);
			} finally {
				uploading = false;
			}
		} else {
			onsubmit(trimmed, undefined, selectedRatio);
			value = '';
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	const noCredits = $derived(credits !== undefined && credits <= 0);
	const canSubmit = $derived(value.trim().length > 0 && !disabled && !noCredits && !uploading);

	let zeroCreditsPromptLogged = $state(false);

	$effect(() => {
		if (!browser) {
			return;
		}
		if (credits === undefined) {
			return;
		}
		if (credits > 0) {
			zeroCreditsPromptLogged = false;
			return;
		}
		if (zeroCreditsPromptLogged) {
			return;
		}
		zeroCreditsPromptLogged = true;
		if (!initPostHog()) {
			return;
		}
		posthog.capture(growthEvents.zeroCreditsPromptShown, { surface: 'prompt_input' });
	});

	function capturePurchaseCta(surface: CreditsPurchaseCtaSurface) {
		if (!browser) {
			return;
		}
		if (!initPostHog()) {
			return;
		}
		posthog.capture(growthEvents.creditsPurchaseCtaClicked, { surface });
	}
</script>

<div class="prompt-input-wrapper min-w-0 max-w-full">
	{#if referencePreviewUrls.length > 0}
		<div class="mb-2 flex min-w-0 flex-wrap items-center gap-2 px-1">
			<div class="flex min-w-0 flex-wrap gap-1.5">
				{#each referencePreviewUrls as url, i}
					<div class="relative h-10 w-10 shrink-0 overflow-hidden border border-border">
						<img src={url} alt="Reference {i + 1}" class="h-full w-full object-cover" />
						<button
							onclick={() => removeReference(i)}
							class="absolute -right-px -top-px flex h-4 w-4 items-center justify-center bg-bg text-dim transition-colors hover:text-text"
							aria-label="Remove reference image {i + 1}"
						>
							<svg class="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none">
								<path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
							</svg>
						</button>
					</div>
				{/each}
			</div>
			<span class="text-[10px] font-medium uppercase tracking-[0.06em] text-dim/60">
				{referencePreviewUrls.length === 1 ? 'Style reference' : `${referencePreviewUrls.length} references`}
			</span>
		</div>
	{/if}

	{#if noCredits}
		<div class="mb-3 border border-red-300 bg-red-50 px-3 py-3 sm:px-4">
			<p class="text-sm font-medium text-red-800">You're out of credits</p>
			<p class="mt-1 text-sm leading-relaxed text-red-700">
				Buy a pack to keep generating, or wait for your free weekly credit when the balance is zero.
			</p>
			<a
				href="/app/credits"
				class="mt-3 inline-flex text-sm font-medium text-accent underline decoration-accent/30 underline-offset-2 transition-colors hover:text-text"
				onclick={() => capturePurchaseCta('prompt_input')}
			>
				View credits & pricing →
			</a>
		</div>
	{/if}

	<div
		class="flex min-w-0 items-center border transition-all duration-200 {noCredits
			? 'border-red-300'
			: focused
				? 'border-accent/40 shadow-[0_0_12px_-4px_var(--color-accent)]'
				: 'border-border'}"
	>
		<button
			onclick={() => fileInput.click()}
			disabled={disabled || referenceFiles.length >= 14}
			class="flex shrink-0 items-center px-3 text-dim transition-colors hover:text-accent disabled:opacity-50"
			title="Add style reference images (up to 14)"
			aria-label="Add style reference images"
		>
			<svg class="h-4 w-4" viewBox="0 0 16 16" fill="none">
				<rect x="1.5" y="1.5" width="13" height="13" rx="1" stroke="currentColor" stroke-width="1.2" />
				<circle cx="5.5" cy="5.5" r="1.5" stroke="currentColor" stroke-width="1" />
				<path d="M1.5 11l3.5-3.5L8.5 11l3-4 3 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</button>

		<input
			bind:this={fileInput}
			type="file"
			accept="image/png,image/jpeg,image/webp"
			multiple
			onchange={handleFileSelect}
			class="hidden"
			aria-hidden="true"
		/>

		<div class="flex shrink-0 items-center pr-2">
			<span class="text-sm font-semibold text-accent" aria-hidden="true">→</span>
		</div>

		<input
			type="text"
			bind:value
			onkeydown={handleKeydown}
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			disabled={disabled || uploading}
			placeholder={uploading ? 'Uploading reference…' : disabled ? 'Generating...' : 'Describe what you need — a logo, character, icon, sticker...'}
			class="min-w-0 flex-1 bg-transparent py-3.5 text-sm text-text outline-none placeholder:text-dim/60 disabled:opacity-50"
		/>

		<button
			onclick={handleSubmit}
			disabled={!canSubmit}
			class="flex shrink-0 items-center gap-2 border-l border-border px-3 py-3.5 text-[11px] font-medium uppercase tracking-[0.06em] transition-all duration-200 sm:px-5
				{canSubmit
					? 'bg-accent/5 text-accent hover:bg-accent hover:text-bg'
					: 'text-dim/40 cursor-not-allowed'}"
		>
			{#if uploading}
				Uploading
			{:else if disabled}
				Working
			{:else}
				Generate
			{/if}
			<svg class="h-3 w-3" viewBox="0 0 12 12" fill="none">
				<path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</button>
	</div>

	<div class="mt-3">
		<AspectRatioSelector
			value={aspectRatio}
			onchange={(ratio) => (aspectRatio = ratio)}
			disabled={disabled || uploading}
		/>
	</div>

	<div
		class="mt-2 flex flex-col gap-1.5 px-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
	>
		<span class="min-w-0 text-[10px] font-medium uppercase tracking-[0.06em] text-dim/50">
			{#if credits !== undefined && credits > 0}
				1 of <span class="tabular-nums">{credits}</span>
				{credits === 1 ? 'credit' : 'credits'}
				{#if credits === 1}
					·
					<a href="/app/credits" class="text-accent transition-colors hover:text-text">Stock up →</a>
				{/if}
			{:else if noCredits}
				<span class="text-red-700">0 credits</span>
			{:else}
				1 credit per generation
			{/if}
		</span>
		<span
			class="shrink-0 text-[10px] font-medium uppercase tracking-[0.06em] text-dim/50 sm:text-end"
		>
			Enter ↵ to generate
		</span>
	</div>
</div>
