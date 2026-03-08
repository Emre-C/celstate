import { getContext, setContext } from 'svelte';
import { useConvexClient } from 'convex-svelte';
import { ConvexHttpClient } from 'convex/browser';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import {
	readStoredToken,
	writeTokens,
	clearTokens,
	readRefreshToken,
	consumeVerifier,
	storeVerifier,
	storeReturnPath,
} from './storage';

/**
 * ⚠️  FRAGILE: Custom auth client for @convex-dev/auth (v0.0.91)
 *
 * @convex-dev/auth only ships a React client. This module replicates its
 * behavior using Svelte 5 runes, reverse-engineered from:
 *   https://github.com/get-convex/convex-auth/blob/main/src/react/client.tsx
 *
 * SERVER ACTION CONTRACT (pinned to @convex-dev/auth@0.0.91):
 *   auth:signIn validator accepts: {calledBy, params, provider, refreshToken, verifier}
 *     - OAuth initiation: {provider: "google", params: {redirectTo: "/auth/callback"}}
 *       → returns {redirect: string, verifier: string}
 *     - Code exchange:   {params: {code: string}, verifier: string}
 *       → returns {tokens: {token: string, refreshToken: string}}
 *     - Token refresh:   {refreshToken: string}
 *       → returns {tokens: {token: string, refreshToken: string}}
 *   auth:signOut accepts: {}
 *
 * KNOWN PITFALL: redirectTo MUST be inside params, NOT at top level.
 *   ✅ {provider, params: {redirectTo}}
 *   ❌ {provider, redirectTo}  ← causes ArgumentValidationError
 *
 * Run `npm run test:auth` after any @convex-dev/auth version bump.
 */

const AUTH_CONTEXT_KEY = '$$_convexAuth';

export interface ConvexAuthState {
	readonly isLoading: boolean;
	readonly isAuthenticated: boolean;
	readonly token: string | null;
	signIn(provider: string): Promise<void>;
	signOut(): Promise<void>;
}

/**
 * Initialize Convex auth in a layout that already has setupConvex() called.
 * This does NOT handle OAuth callback — that's handled by /auth/callback.
 * It only restores auth from localStorage and wires up token refresh.
 */
export function setupConvexAuth(): ConvexAuthState {
	const client = useConvexClient();

	let token: string | null = $state(readStoredToken());
	let isLoading = $state(false);

	function setTokens(jwt: string | null, refreshToken?: string | null, persist = true) {
		token = jwt;
		if (persist) {
			if (jwt) {
				writeTokens(jwt, refreshToken ?? undefined);
			} else {
				clearTokens();
			}
		}
		isLoading = false;
	}

	async function fetchAccessToken({
		forceRefreshToken,
	}: {
		forceRefreshToken: boolean;
	}): Promise<string | null> {
		if (forceRefreshToken) {
			const refreshToken = readRefreshToken();
			if (refreshToken) {
				const httpClient = new ConvexHttpClient(PUBLIC_CONVEX_URL);
				const result = await httpClient.action('auth:signIn' as any, {
					refreshToken,
				});
				if (result?.tokens) {
					setTokens(result.tokens.token, result.tokens.refreshToken);
					return result.tokens.token;
				}
			}
			setTokens(null);
			return null;
		}
		return token;
	}

	client.setAuth(fetchAccessToken);

	const state: ConvexAuthState = {
		get isLoading() {
			return isLoading;
		},
		get isAuthenticated() {
			return token !== null;
		},
		get token() {
			return token;
		},
		async signIn(provider: string) {
			const result = await client.action('auth:signIn' as any, {
				provider,
				params: { redirectTo: '/auth/callback' },
			});

			if (result.redirect) {
				storeVerifier(result.verifier);
				storeReturnPath(window.location.pathname + window.location.search + window.location.hash);
				window.location.href = result.redirect;
			} else if (result.tokens) {
				setTokens(result.tokens.token, result.tokens.refreshToken);
				client.setAuth(fetchAccessToken);
			}
		},
		async signOut() {
			try {
				await client.action('auth:signOut' as any, {});
			} catch {
				// Ignore errors — usually means already signed out
			}
			setTokens(null);
			client.setAuth(fetchAccessToken);
		},
	};

	setContext(AUTH_CONTEXT_KEY, state);
	return state;
}

export function useConvexAuth(): ConvexAuthState {
	const ctx = getContext<ConvexAuthState | undefined>(AUTH_CONTEXT_KEY);
	if (!ctx) {
		throw new Error('No ConvexAuth found. Did you call setupConvexAuth() in a parent component?');
	}
	return ctx;
}
