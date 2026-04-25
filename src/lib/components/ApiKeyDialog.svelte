<script lang="ts">
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import type { FunctionArgs } from 'convex/server';
	import MonoLabel from '$lib/components/ui/MonoLabel.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import {
		buildClaudeCodeCommand,
		buildHostedMcpUrl,
		buildMcpJsonConfig
	} from '$lib/mcp/clientConfig.js';
	import { api } from '../../convex/_generated/api.js';

	type McpApiKeyId = FunctionArgs<typeof api.mcp.keys.revokeKey>['keyId'];

	let { open = $bindable(false) }: { open: boolean } = $props();

	const client = useConvexClient();
	const keysQuery = useQuery(api.mcp.keys.listKeys, {});

	let keyName = $state('');
	let rawKey = $state<string | null>(null);
	let error = $state('');
	let copied = $state<'command' | 'config' | 'key' | null>(null);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	let resetTimer: ReturnType<typeof setTimeout> | undefined;
	let creating = $state(false);
	let revoking = $state<McpApiKeyId | null>(null);

	const activeKeys = $derived.by(() =>
		(keysQuery.data ?? []).filter((key) => key.revokedAt === undefined)
	);
	const revokedKeys = $derived.by(() =>
		(keysQuery.data ?? []).filter((key) => key.revokedAt !== undefined)
	);
	const mcpUrlState = $derived.by(() => {
		try {
			return { url: buildHostedMcpUrl(PUBLIC_CONVEX_URL), error: null as string | null };
		} catch (e) {
			return {
				url: '',
				error: e instanceof Error ? e.message : 'Invalid deployment URL'
			};
		}
	});
	const mcpUrl = $derived(mcpUrlState.url);
	const mcpUrlError = $derived(mcpUrlState.error);
	const claudeCodeCommand = $derived(rawKey ? buildClaudeCodeCommand(mcpUrl, rawKey) : '');
	const configSnippet = $derived(rawKey ? buildMcpJsonConfig(mcpUrl, rawKey) : '');
	const isRevealView = $derived(rawKey !== null);

	function resetForm() {
		keyName = '';
		rawKey = null;
		error = '';
		creating = false;
		revoking = null;
		copied = null;
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

	async function copyToClipboard(text: string, which: 'command' | 'key' | 'config') {
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
		class="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 px-4 py-8 backdrop-blur-md"
		onmousedown={handleBackdropClick}
	>
		<div
			class="relative w-full max-w-3xl overflow-hidden border border-border bg-bg shadow-[0_32px_80px_rgba(28,25,23,0.12)]"
			role="dialog"
			aria-modal="true"
			aria-label="Celstate API access"
		>
			<div class="border-b border-border/80 bg-[linear-gradient(180deg,rgba(194,65,12,0.06),rgba(194,65,12,0))] px-6 py-5 sm:px-8">
				<div class="flex items-start justify-between gap-4">
					<div class="max-w-2xl space-y-3">
						<SectionLabel text="Agent Access" />
						<div class="space-y-2">
							<h2 class="font-display text-3xl italic tracking-tight text-text sm:text-[2.15rem]">
								{#if isRevealView}
									New key, ready to wire in
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
					onclick={handleClose}
					aria-label="Close"
					class="rounded-full border border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-dim transition-colors hover:border-accent hover:text-text"
				>
					Close
				</button>
				</div>
			</div>

			<div class="space-y-6 px-6 py-6 sm:px-8">
				{#if mcpUrlError}
					<div class="rounded-[1.75rem] border border-amber-300 bg-amber-50 px-4 py-3">
						<p class="text-sm leading-6 text-amber-900">{mcpUrlError}</p>
					</div>
				{/if}
				{#if error}
					<div class="rounded-[1.75rem] border border-red-300 bg-red-50 px-4 py-3">
						<p class="text-sm leading-6 text-red-700">{error}</p>
					</div>
				{/if}

				{#if isRevealView}
					<div class="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
						<div class="rounded-[2rem] border border-border bg-white/40 p-5">
							<div class="space-y-4">
								<div class="space-y-2">
									<MonoLabel>One-time secret</MonoLabel>
									<p class="text-sm leading-6 text-dim">
										Copy this key now. After you close the dialog, Celstate only keeps the hash and last-used timestamp.
									</p>
								</div>
								<div class="rounded-[1.5rem] border border-border bg-bg px-4 py-4">
									<p class="break-all text-sm leading-6 text-text">{rawKey}</p>
								</div>
								<button
									type="button"
									onclick={() => copyToClipboard(rawKey!, 'key')}
									class="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent/90"
								>
									{copied === 'key' ? 'Key copied' : 'Copy key'}
								</button>
							</div>
						</div>

						<div class="space-y-4">
							{#if mcpUrlError}
								<div class="rounded-[2rem] border border-border bg-white/40 p-5">
									<p class="text-sm leading-6 text-dim">
										Fix the deployment URL (see above) to generate Claude Code and JSON config snippets.
									</p>
								</div>
							{:else}
								<div class="rounded-[2rem] border border-border bg-white/40 p-5">
									<div class="space-y-3">
										<MonoLabel>Claude Code</MonoLabel>
										<p class="text-sm leading-6 text-dim">
											Paste this once in your terminal to add Celstate as a remote HTTP MCP server.
										</p>
										<pre class="overflow-x-auto rounded-[1.5rem] border border-border bg-bg p-4 text-sm leading-6 whitespace-pre-wrap text-text">{claudeCodeCommand}</pre>
										<button
											type="button"
											onclick={() => copyToClipboard(claudeCodeCommand, 'command')}
											class="rounded-full border border-border px-4 py-2 text-[10px] font-medium uppercase tracking-[0.06em] text-dim transition-colors hover:border-accent hover:text-text"
										>
											{copied === 'command' ? 'Command copied' : 'Copy command'}
										</button>
									</div>
								</div>

								<div class="rounded-[2rem] border border-border bg-white/40 p-5">
									<div class="space-y-3">
										<MonoLabel>Manual JSON config</MonoLabel>
										<pre class="overflow-x-auto rounded-[1.5rem] border border-border bg-bg p-4 text-sm leading-6 whitespace-pre-wrap text-text">{configSnippet}</pre>
										<button
											type="button"
											onclick={() => copyToClipboard(configSnippet, 'config')}
											class="rounded-full border border-border px-4 py-2 text-[10px] font-medium uppercase tracking-[0.06em] text-dim transition-colors hover:border-accent hover:text-text"
										>
											{copied === 'config' ? 'Config copied' : 'Copy JSON config'}
										</button>
									</div>
								</div>
							{/if}
						</div>
					</div>

					<div class="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-border/80 bg-white/30 px-4 py-3">
						<p class="text-sm leading-6 text-dim">
							Endpoint: <span class="font-medium text-text">{mcpUrl}</span>
						</p>
						<button
							type="button"
							onclick={resetForm}
							class="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent/90"
						>
							Done
						</button>
					</div>
				{:else}
					<div class="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
						<div class="space-y-4">
							<div class="rounded-[2rem] border border-border bg-white/40 p-5">
								<div class="flex flex-wrap items-start justify-between gap-4">
									<div class="space-y-2">
										<MonoLabel>Endpoint</MonoLabel>
										<p class="text-sm leading-6 text-dim">
											Point your client at this hosted MCP URL.
										</p>
										<p class="break-all text-sm leading-6 text-text">{mcpUrl}</p>
									</div>
									<div class="rounded-full border border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-dim">
										{activeKeys.length} active key{activeKeys.length === 1 ? '' : 's'}
									</div>
								</div>
							</div>

							<div class="rounded-[2rem] border border-border bg-white/40 p-5">
								<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
									<div>
										<MonoLabel>Active keys</MonoLabel>
										<p class="mt-2 text-sm leading-6 text-dim">
											Revoke keys you no longer trust. Last-used timestamps update only after successful authenticated requests.
										</p>
									</div>
									{#if revokedKeys.length > 0}
										<div class="rounded-full border border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-dim">
											{revokedKeys.length} revoked
										</div>
									{/if}
								</div>

								{#if activeKeys.length > 0}
									<div class="space-y-3">
										{#each activeKeys as key (key._id)}
											<div class="rounded-[1.5rem] border border-border bg-bg/80 px-4 py-4">
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
														class="rounded-full border border-border px-4 py-2 text-[10px] font-medium uppercase tracking-[0.06em] text-dim transition-colors hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
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
							</div>
						</div>

						<div class="rounded-[2rem] border border-border bg-white/40 p-5">
							<div class="space-y-4">
								<div class="space-y-2">
									<MonoLabel>Create a new key</MonoLabel>
									<p class="text-sm leading-6 text-dim">
										Name the client you’re authorizing so you can spot it later in your list.
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
										class="w-full rounded-full border border-border bg-bg px-4 py-3 text-sm text-text placeholder:text-dim/60 focus:border-accent focus:outline-none"
									/>
								</div>
								<button
									type="button"
									onclick={handleCreate}
									disabled={!keyName.trim() || creating}
									class="w-full rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{creating ? 'Creating key...' : 'Create key'}
								</button>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
