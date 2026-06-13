<script lang="ts">
	import { browser } from '$app/environment';
	import { PUBLIC_SITE_URL } from '$env/static/public';
	import { tick } from 'svelte';
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import type { FunctionArgs } from 'convex/server';
	import MonoLabel from '$lib/components/ui/MonoLabel.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import {
		buildClaudeCodeCommand,
		buildPublicMcpUrl,
		buildMcpJsonConfig
	} from '$lib/mcp/clientConfig.js';
	import { api } from '../../convex/_generated/api.js';

	type McpApiKeyId = FunctionArgs<typeof api.mcp.keys.revokeKey>['keyId'];
	type CopyTarget = 'command' | 'config' | 'endpoint' | 'key';
	type SetupView = 'claude' | 'json';

	let { open = $bindable(false) }: { open: boolean } = $props();

	const client = useConvexClient();
	const keysQuery = useQuery(api.mcp.keys.listKeys, {});

	let keyName = $state('');
	let rawKey = $state<string | null>(null);
	let error = $state('');
	let copied = $state<CopyTarget | null>(null);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	let resetTimer: ReturnType<typeof setTimeout> | undefined;
	let creating = $state(false);
	let revoking = $state<McpApiKeyId | null>(null);
	let setupView = $state<SetupView>('claude');
	let closeButtonEl: HTMLButtonElement | undefined = $state();

	const activeKeys = $derived.by(() =>
		(keysQuery.data ?? []).filter((key) => key.revokedAt === undefined)
	);
	const revokedKeys = $derived.by(() =>
		(keysQuery.data ?? []).filter((key) => key.revokedAt !== undefined)
	);
	const mcpUrlState = $derived.by(() => {
		try {
			return { url: buildPublicMcpUrl(PUBLIC_SITE_URL), error: null as string | null };
		} catch (e) {
			return {
				url: '',
				error: e instanceof Error ? e.message : 'Invalid public site URL'
			};
		}
	});
	const mcpUrl = $derived(mcpUrlState.url);
	const mcpUrlError = $derived(mcpUrlState.error);
	const claudeCodeCommand = $derived(rawKey ? buildClaudeCodeCommand(mcpUrl, rawKey) : '');
	const configSnippet = $derived(rawKey ? buildMcpJsonConfig(mcpUrl, rawKey) : '');
	const isRevealView = $derived(rawKey !== null);
	const setupSnippet = $derived(setupView === 'claude' ? claudeCodeCommand : configSnippet);
	const setupCopyTarget = $derived<CopyTarget>(setupView === 'claude' ? 'command' : 'config');
	const setupCopyText = $derived(setupView === 'claude' ? 'Copy command' : 'Copy JSON');
	const setupCopiedText = $derived(setupView === 'claude' ? 'Command copied' : 'JSON copied');

	$effect(() => {
		if (!browser || !open) {
			return;
		}

		const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		void tick().then(() => {
			closeButtonEl?.focus();
		});

		return () => {
			document.body.style.overflow = previousOverflow;
			previousFocus?.focus();
		};
	});

	function resetForm() {
		keyName = '';
		rawKey = null;
		error = '';
		creating = false;
		revoking = null;
		copied = null;
		setupView = 'claude';
		clearTimeout(copiedTimer);
		clearTimeout(resetTimer);
	}

	function handleClose() {
		open = false;
		clearTimeout(resetTimer);
		resetTimer = setTimeout(resetForm, 180);
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			handleClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			handleClose();
		}
	}

	async function handleCreate() {
		const name = keyName.trim();
		if (!name || creating) {
			return;
		}

		error = '';
		creating = true;
		setupView = 'claude';

		try {
			const result = await client.action(api.mcp.keys.createKey, { name });
			rawKey = result.rawKey;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create key';
		} finally {
			creating = false;
		}
	}

	async function handleRevoke(keyId: McpApiKeyId) {
		if (revoking) return;
		revoking = keyId;
		error = '';

		try {
			await client.mutation(api.mcp.keys.revokeKey, { keyId });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to revoke key';
		} finally {
			revoking = null;
		}
	}

	async function copyToClipboard(text: string, which: CopyTarget) {
		if (!text) {
			return;
		}

		try {
			await navigator.clipboard.writeText(text);
			copied = which;
			clearTimeout(copiedTimer);
			copiedTimer = setTimeout(() => (copied = null), 2000);
		} catch {}
	}

	function formatRelativeTime(ms: number): string {
		const seconds = Math.floor((Date.now() - ms) / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function formatCalendarTime(ms: number): string {
		return new Intl.DateTimeFormat(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(ms);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-bg/85 px-3 py-4 backdrop-blur-sm sm:px-6 sm:py-8"
		onmousedown={handleBackdropClick}
	>
		<div
			class="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-bg shadow-[0_28px_70px_rgba(28,25,23,0.14)] sm:max-h-[calc(100dvh-4rem)]"
			role="dialog"
			aria-modal="true"
			aria-labelledby="api-key-dialog-title"
		>
			<div class="shrink-0 border-b border-border bg-bg px-5 py-4 sm:px-7">
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0 space-y-3">
						<SectionLabel text="Agent Access" />
						<div class="space-y-2">
							<h2
								id="api-key-dialog-title"
								class="font-display text-3xl italic tracking-tight text-text sm:text-[2.15rem]"
							>
								{#if isRevealView}
									New key, ready to connect
								{:else}
									Connect Celstate to your agent
								{/if}
							</h2>
							<p class="max-w-xl text-sm leading-6 text-dim">
								Built for agentic clients such as Claude Code and Cursor. Each key is scoped to your Celstate account and carries your credit balance.
							</p>
						</div>
					</div>
					<button
						type="button"
						bind:this={closeButtonEl}
						onclick={handleClose}
						aria-label="Close API access dialog"
						class="shrink-0 rounded-full border border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-dim transition-colors hover:border-accent hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					>
						Close
					</button>
				</div>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
				<div class="space-y-4">
					{#if mcpUrlError}
						<div class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
							<p class="text-sm leading-6 text-amber-900">{mcpUrlError}</p>
						</div>
					{/if}
					{#if error}
						<div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3">
							<p class="text-sm leading-6 text-red-700">{error}</p>
						</div>
					{/if}

					{#if isRevealView}
						<div class="grid gap-4 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
							<section class="rounded-lg border border-border bg-border/20 p-4 sm:p-5">
								<div class="space-y-4">
									<div class="space-y-2">
										<MonoLabel>One-time secret</MonoLabel>
										<p class="text-sm leading-6 text-dim">
											Copy this key now. After this dialog closes, Celstate only keeps the hash and last-used timestamp.
										</p>
									</div>
									<div class="max-h-40 overflow-y-auto rounded-md border border-border bg-bg px-4 py-3">
										<p class="break-all text-sm leading-6 text-text">{rawKey}</p>
									</div>
									<button
										type="button"
										onclick={() => copyToClipboard(rawKey!, 'key')}
										class="inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
									>
										{copied === 'key' ? 'Key copied' : 'Copy key'}
									</button>
								</div>
							</section>

							<section class="rounded-lg border border-border bg-border/20 p-4 sm:p-5">
								<div class="space-y-4">
									<div class="flex flex-wrap items-start justify-between gap-3">
										<div class="space-y-2">
											<MonoLabel>Client setup</MonoLabel>
											<p class="text-sm leading-6 text-dim">
												Use the public Celstate MCP endpoint for every client.
											</p>
										</div>
										<div class="flex rounded-full border border-border bg-bg p-1">
											<button
												type="button"
												onclick={() => (setupView = 'claude')}
												class="rounded-full px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.06em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent {setupView === 'claude' ? 'bg-accent text-white' : 'text-dim hover:text-text'}"
											>
												Claude
											</button>
											<button
												type="button"
												onclick={() => (setupView = 'json')}
												class="rounded-full px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.06em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent {setupView === 'json' ? 'bg-accent text-white' : 'text-dim hover:text-text'}"
											>
												JSON
											</button>
										</div>
									</div>

									{#if mcpUrlError}
										<p class="rounded-md border border-border bg-bg px-4 py-3 text-sm leading-6 text-dim">
											Fix the public site URL to generate setup snippets.
										</p>
									{:else}
										<pre class="max-h-56 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded-md border border-border bg-bg p-4 font-sans text-sm leading-6 text-text">{setupSnippet}</pre>
										<button
											type="button"
											onclick={() => copyToClipboard(setupSnippet, setupCopyTarget)}
											class="inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
										>
											{copied === setupCopyTarget ? setupCopiedText : setupCopyText}
										</button>
									{/if}
								</div>
							</section>
						</div>
					{:else}
						<div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
							<div class="space-y-4">
								<section class="rounded-lg border border-border bg-border/20 p-4 sm:p-5">
									<div class="flex flex-wrap items-start justify-between gap-4">
										<div class="min-w-0 space-y-2">
											<MonoLabel>Public endpoint</MonoLabel>
											<p class="text-sm leading-6 text-dim">
												Point your agent at Celstate's hosted MCP URL.
											</p>
											<p class="break-all text-sm font-medium leading-6 text-text">{mcpUrl}</p>
										</div>
										<button
											type="button"
											onclick={() => copyToClipboard(mcpUrl, 'endpoint')}
											disabled={mcpUrlError !== null}
											class="rounded-full border border-border px-4 py-2 text-[10px] font-medium uppercase tracking-[0.06em] text-dim transition-colors hover:border-accent hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
										>
											{copied === 'endpoint' ? 'Copied' : 'Copy'}
										</button>
									</div>
								</section>

								<section class="rounded-lg border border-border bg-border/20 p-4 sm:p-5">
									<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
										<div class="space-y-2">
											<MonoLabel>Active keys</MonoLabel>
											<p class="text-sm leading-6 text-dim">
												Revoke keys you no longer trust. Last-used timestamps update after successful authenticated requests.
											</p>
										</div>
										<div class="rounded-full border border-border bg-bg px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-dim">
											{activeKeys.length} active
										</div>
									</div>

									{#if activeKeys.length > 0}
										<div class="space-y-3">
											{#each activeKeys as key (key._id)}
												<div class="rounded-md border border-border bg-bg px-4 py-4">
													<div class="flex flex-wrap items-start justify-between gap-4">
														<div class="min-w-0 space-y-2">
															<div class="flex flex-wrap items-center gap-2">
																<p class="text-sm font-medium text-text">{key.name}</p>
																<span class="rounded-full border border-border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.06em] text-dim">
																	{key.keyPrefix}...
																</span>
															</div>
															<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-dim">
																<span>Created {formatCalendarTime(key.createdAt)}</span>
																<span>
																	{#if key.lastUsedAt}
																		Used {formatRelativeTime(key.lastUsedAt)}
																	{:else}
																		Never used
																	{/if}
																</span>
															</div>
														</div>
														<button
															type="button"
															onclick={() => handleRevoke(key._id)}
															disabled={revoking === key._id}
															class="rounded-full border border-border px-4 py-2 text-[10px] font-medium uppercase tracking-[0.06em] text-dim transition-colors hover:border-red-300 hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
														>
															{revoking === key._id ? 'Revoking...' : 'Revoke'}
														</button>
													</div>
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-sm leading-6 text-dim">
											No keys yet. Create one to let your agent check credits, generate images, and inspect recent work.
										</p>
									{/if}

									{#if revokedKeys.length > 0}
										<p class="mt-4 text-[10px] font-medium uppercase tracking-[0.06em] text-dim">
											{revokedKeys.length} revoked
										</p>
									{/if}
								</section>
							</div>

							<section class="rounded-lg border border-border bg-border/20 p-4 sm:p-5">
								<div class="space-y-4">
									<div class="space-y-2">
										<MonoLabel>Create a new key</MonoLabel>
										<p class="text-sm leading-6 text-dim">
											Name the client you're authorizing so you can spot it later.
										</p>
									</div>
									<div class="space-y-3">
										<label for="key-name" class="text-[10px] font-medium uppercase tracking-[0.08em] text-accent">
											Key name
										</label>
										<input
											id="key-name"
											type="text"
											bind:value={keyName}
											placeholder="Claude Code"
											maxlength="64"
											onkeydown={(event) => event.key === 'Enter' && handleCreate()}
											class="w-full rounded-full border border-border bg-bg px-4 py-3 text-sm text-text placeholder:text-dim/60 focus:border-accent focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
										/>
									</div>
									<button
										type="button"
										onclick={handleCreate}
										disabled={!keyName.trim() || creating}
										class="w-full rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
									>
										{creating ? 'Creating key...' : 'Create key'}
									</button>
								</div>
							</section>
						</div>
					{/if}
				</div>
			</div>

			<div class="shrink-0 border-t border-border bg-bg px-5 py-3 sm:px-7">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<p class="min-w-0 break-all text-sm leading-6 text-dim">
						Endpoint: <span class="font-medium text-text">{mcpUrl}</span>
					</p>
					<button
						type="button"
						onclick={isRevealView ? resetForm : handleClose}
						class="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					>
						{isRevealView ? 'Done' : 'Close'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
