import { getContext, setContext } from 'svelte';
import { useConvexClient } from 'convex-svelte';
import { ConvexHttpClient } from 'convex/browser';
import { goto } from '$app/navigation';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

const AUTH_CONTEXT_KEY = '$$_convexAuth';

const VERIFIER_KEY = '__convexAuthOAuthVerifier';
const JWT_KEY = '__convexAuthJWT';
const REFRESH_TOKEN_KEY = '__convexAuthRefreshToken';
const RETURN_PATH_KEY = '__convexAuthReturnPath';

function storageKey(key: string): string {
	const escaped = PUBLIC_CONVEX_URL.replace(/[^a-zA-Z0-9]/g, '');
	return `${key}_${escaped}`;
}

function storageGet(key: string): string | null {
	return localStorage.getItem(storageKey(key));
}

function storageSet(key: string, value: string): void {
	localStorage.setItem(storageKey(key), value);
}

function storageRemove(key: string): void {
	localStorage.removeItem(storageKey(key));
}

export interface ConvexAuthState {
	readonly isLoading: boolean;
	readonly isAuthenticated: boolean;
	readonly token: string | null;
	signIn(provider: string): Promise<void>;
	signOut(): Promise<void>;
}

export function setupConvexAuth(): ConvexAuthState {
	const client = useConvexClient();

	// Detect OAuth callback synchronously to avoid flash of landing page
	const hasCallbackCode =
		typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('code');

	// Only show loading state when processing an OAuth callback.
	// Normal visits resolve auth synchronously from localStorage (no loading flash).
	let token: string | null = $state(hasCallbackCode ? null : (storageGet(JWT_KEY) ?? null));
	let isLoading = $state(hasCallbackCode);

	function setTokens(jwt: string | null, refreshToken?: string | null, persist = true) {
		token = jwt;
		if (persist) {
			if (jwt) {
				storageSet(JWT_KEY, jwt);
				if (refreshToken) storageSet(REFRESH_TOKEN_KEY, refreshToken);
			} else {
				storageRemove(JWT_KEY);
				storageRemove(REFRESH_TOKEN_KEY);
			}
		}
		isLoading = false;
	}

	async function fetchAccessToken({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> {
		if (forceRefreshToken) {
			const refreshToken = storageGet(REFRESH_TOKEN_KEY);
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

	// Wire up auth token provider to ConvexClient
	client.setAuth(fetchAccessToken);

	// On mount: check for OAuth callback code in URL, or restore from storage
	$effect(() => {
		const params = new URLSearchParams(window.location.search);
		const code = params.get('code');

		if (code) {
			// OAuth callback — exchange code for tokens
			const verifier = storageGet(VERIFIER_KEY) ?? undefined;
			storageRemove(VERIFIER_KEY);

			const url = new URL(window.location.href);
			url.searchParams.delete('code');
			window.history.replaceState({}, '', url.pathname + url.search + url.hash);

			const httpClient = new ConvexHttpClient(PUBLIC_CONVEX_URL);
			httpClient
				.action('auth:signIn' as any, {
					params: { code },
					verifier,
				})
				.then((result: any) => {
					if (result?.tokens) {
						setTokens(result.tokens.token, result.tokens.refreshToken);
						const returnPath = storageGet(RETURN_PATH_KEY);
						storageRemove(RETURN_PATH_KEY);
						if (returnPath && returnPath !== window.location.pathname) {
							goto(returnPath);
						}
					} else {
						setTokens(null);
					}
				})
				.catch(() => {
					setTokens(null);
				});
		} else {
			// Restore from localStorage
			const stored = storageGet(JWT_KEY);
			if (stored) {
				setTokens(stored, undefined, false);
			} else {
				setTokens(null, null, false);
			}
		}
	});

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
			const verifier = storageGet(VERIFIER_KEY) ?? undefined;
			storageRemove(VERIFIER_KEY);

			const result = await client.action('auth:signIn' as any, {
				provider,
				params: {},
				verifier,
			});

			if (result.redirect) {
				storageSet(VERIFIER_KEY, result.verifier);
				storageSet(RETURN_PATH_KEY, window.location.pathname);
				window.location.href = result.redirect;
			} else if (result.tokens) {
				setTokens(result.tokens.token, result.tokens.refreshToken);
			}
		},
		async signOut() {
			try {
				await client.action('auth:signOut' as any, {});
			} catch {
				// Ignore errors — usually means already signed out
			}
			setTokens(null);
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
