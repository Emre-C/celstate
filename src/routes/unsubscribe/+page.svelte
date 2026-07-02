<script lang="ts">
	import { onMount } from 'svelte';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { ConvexHttpClient } from 'convex/browser';
	import { api } from '../../convex/_generated/api.js';
	import { initPostHog, posthog } from '$lib/analytics/client-posthog.js';

	let { data } = $props();

	let status = $state<'unsubscribing' | 'unsubscribed' | 'not_found' | 'error'>('unsubscribing');
	let feedbackSubmitted = $state(false);
	let selectedReason = $state<string | null>(null);
	let feedbackText = $state('');
	let submitting = $state(false);

	const reasons = [
		{ value: 'not_what_i_expected', label: 'Not what I expected' },
		{ value: 'too_many_emails', label: 'Too many emails' },
		{ value: 'didnt_use_it', label: "Didn't end up using it" },
		{ value: 'quality_issues', label: 'Output quality was lacking' },
		{ value: 'other', label: 'Other' },
	];

	onMount(async () => {
		if (!data?.email || !data?.token) {
			status = 'error';
			return;
		}

		try {
			const client = new ConvexHttpClient(PUBLIC_CONVEX_URL);
			const ok = await client.mutation(api.emails.unsubscribe, {
				email: data.email,
				token: data.token,
			});
			status = ok ? 'unsubscribed' : 'not_found';
		} catch {
			status = 'error';
		}
	});

	async function submitFeedback() {
		if (submitting || (!selectedReason && !feedbackText.trim())) return;
		submitting = true;
		try {
			if (initPostHog()) {
				posthog.capture('unsubscribe_feedback_submitted', {
					email: data?.email,
					reason: selectedReason,
					feedback: feedbackText.trim() || undefined,
				});
			}
		} finally {
			submitting = false;
			feedbackSubmitted = true;
		}
	}
</script>

<svelte:head>
	<title>Unsubscribed — Celstate</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="min-h-dvh bg-bg flex items-center justify-center px-6 py-16">
	<div class="w-full max-w-md">
		{#if status === 'unsubscribing'}
			<div class="text-center">
				<div class="mx-auto mb-6 h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent"></div>
				<p class="text-sm text-dim">Unsubscribing...</p>
			</div>
		{:else if status === 'unsubscribed'}
			<div class="text-center">
				<h1 class="font-display italic text-3xl text-text mb-4">
					We hate to see you go
				</h1>
				<p class="text-sm text-dim leading-relaxed mb-8">
					You've been unsubscribed from Celstate emails. You won't hear
					from us again. But if you have a moment, tell us why, so we
					can make things better.
				</p>

				{#if feedbackSubmitted}
					<div class="border border-border bg-white/50 rounded-lg p-6">
						<p class="text-sm text-text font-medium mb-1">Thank you.</p>
						<p class="text-sm text-dim leading-relaxed">
							Every piece of feedback helps us improve. If you ever
							want to come back, your credits will still be there.
						</p>
					</div>
				{:else}
					<div class="text-left">
						<p class="text-[11px] font-medium uppercase tracking-[0.08em] text-accent mb-4">
							What went wrong?
						</p>
						<div class="space-y-2 mb-4">
							{#each reasons as reason}
								<label
									class="flex items-center gap-3 rounded-lg border border-border bg-white/50 px-4 py-3 cursor-pointer transition-colors hover:border-accent/30 {selectedReason === reason.value ? 'border-accent/40 bg-accent/5' : ''}"
								>
									<input
										type="radio"
										name="reason"
										value={reason.value}
										bind:group={selectedReason}
										class="h-4 w-4 accent-accent"
									/>
									<span class="text-sm text-text">{reason.label}</span>
								</label>
							{/each}
						</div>

						{#if selectedReason === 'other' || (selectedReason && selectedReason !== 'not_what_i_expected')}
							<textarea
								bind:value={feedbackText}
								placeholder="Tell us more (optional)"
								rows="3"
								class="w-full rounded-lg border border-border bg-white/50 px-4 py-3 text-sm text-text placeholder:text-dim/60 focus:outline-none focus:border-accent/40 mb-4 resize-none"
							></textarea>
						{/if}

						<button
							onclick={submitFeedback}
							disabled={submitting || (!selectedReason && !feedbackText.trim())}
							class="w-full rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
						>
							{submitting ? 'Sending...' : 'Send feedback'}
						</button>
						{#if !selectedReason && !feedbackText.trim()}
							<p class="text-center mt-3">
								<button
									onclick={() => (feedbackSubmitted = true)}
									class="text-xs text-dim underline hover:text-text"
								>
									Skip and close
								</button>
							</p>
						{/if}
					</div>
				{/if}
			</div>
		{:else if status === 'not_found'}
			<div class="text-center">
				<h1 class="font-display italic text-3xl text-text mb-4">
					We couldn't find that email
				</h1>
				<p class="text-sm text-dim leading-relaxed">
					We couldn't find an account associated with this email
					address. If you believe this is an error, reply to the email
					you received and let us know.
				</p>
			</div>
		{:else}
			<div class="text-center">
				<h1 class="font-display italic text-3xl text-text mb-4">
					Something went wrong
				</h1>
				<p class="text-sm text-dim leading-relaxed">
					We couldn't process your unsubscribe request. Please reply to
					the email you received and ask to be unsubscribed.
				</p>
			</div>
		{/if}

		<p class="text-center mt-12 text-xs text-dim/60">
			Celstate
		</p>
	</div>
</div>
