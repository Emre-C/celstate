<script lang="ts">
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import AspectRatioSelector from './AspectRatioSelector.svelte';

	let {
		onsubmit,
		disabled = false,
		credits
	}: {
		onsubmit: (prompt: string, referenceStorageId?: string, aspectRatio?: string) => void;
		disabled?: boolean;
		credits?: number;
	} = $props();

	const client = useConvexClient();

	let value = $state('');
	let focused = $state(false);
	let referenceFile = $state<File | null>(null);
	let referencePreviewUrl = $state<string | null>(null);
	let uploading = $state(false);
	let aspectRatio = $state('1:1');

	let fileInput: HTMLInputElement;

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		referenceFile = file;
		referencePreviewUrl = URL.createObjectURL(file);
		input.value = '';
	}

	function clearReference() {
		if (referencePreviewUrl) {
			URL.revokeObjectURL(referencePreviewUrl);
		}
		referenceFile = null;
		referencePreviewUrl = null;
	}

	async function handleSubmit() {
		const trimmed = value.trim();
		if (!trimmed || disabled || uploading) return;

		const selectedRatio = aspectRatio === '1:1' ? undefined : aspectRatio;

		if (referenceFile) {
			uploading = true;
			try {
				const uploadUrl = await client.mutation(api.generations.generateUploadUrl, {});
				const uploadResponse = await fetch(uploadUrl, {
					method: 'POST',
					headers: { 'Content-Type': referenceFile.type },
					body: referenceFile,
				});
				const { storageId } = await uploadResponse.json();
				value = '';
				clearReference();
				onsubmit(trimmed, storageId, selectedRatio);
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
</script>

<div class="prompt-input-wrapper">
	<!-- Reference image preview -->
	{#if referencePreviewUrl}
		<div class="mb-2 flex items-center gap-2 px-1">
			<div class="relative h-10 w-10 shrink-0 overflow-hidden border border-border">
				<img src={referencePreviewUrl} alt="Reference" class="h-full w-full object-cover" />
				<button
					onclick={clearReference}
					class="absolute -right-px -top-px flex h-4 w-4 items-center justify-center bg-bg text-dim transition-colors hover:text-text"
					aria-label="Remove reference image"
				>
					<svg class="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none">
						<path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
					</svg>
				</button>
			</div>
			<span class="font-mono text-[10px] tracking-[0.15em] uppercase text-dim/60">
				Style reference
			</span>
		</div>
	{/if}

	<div
		class="flex items-center border transition-all duration-200 {focused
			? 'border-accent/40 shadow-[0_0_12px_-4px_var(--color-accent)]'
			: 'border-border'}"
	>
		<!-- Reference upload button -->
		<button
			onclick={() => fileInput.click()}
			disabled={disabled}
			class="flex shrink-0 items-center px-3 text-dim transition-colors hover:text-accent disabled:opacity-50"
			title="Add style reference image"
			aria-label="Add style reference image"
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
			onchange={handleFileSelect}
			class="hidden"
			aria-hidden="true"
		/>

		<!-- Terminal prompt indicator -->
		<div class="flex shrink-0 items-center pr-2">
			<span class="font-mono text-sm text-accent" aria-hidden="true">&gt;_</span>
		</div>

		<!-- Input -->
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

		<!-- Submit button -->
		<button
			onclick={handleSubmit}
			disabled={!canSubmit}
			class="flex shrink-0 items-center gap-2 border-l border-border px-5 py-3.5 font-mono text-[11px] tracking-[0.15em] uppercase transition-all duration-200
				{canSubmit
					? 'bg-accent/5 text-accent hover:bg-accent hover:text-bg'
					: 'text-dim/40 cursor-not-allowed'}"
		>
			{#if noCredits}
				<a href="/app/credits" class="text-red-400 hover:text-red-300">Get credits</a>
			{:else if uploading}
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

	<!-- Aspect ratio selector -->
	<div class="mt-3">
		<AspectRatioSelector
			value={aspectRatio}
			onchange={(ratio) => (aspectRatio = ratio)}
			disabled={disabled || uploading}
		/>
	</div>

	<!-- Helper text -->
	<div class="mt-2 flex items-center justify-between px-1">
		<span class="font-mono text-[10px] tracking-[0.15em] uppercase text-dim/50">
			1 credit per generation
		</span>
		<span class="font-mono text-[10px] tracking-[0.15em] uppercase text-dim/50">
			Enter ↵ to generate
		</span>
	</div>
</div>
