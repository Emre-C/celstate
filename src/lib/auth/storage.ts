import { browser } from '$app/environment';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

const VERIFIER_KEY = '__convexAuthOAuthVerifier';
const JWT_KEY = '__convexAuthJWT';
const REFRESH_TOKEN_KEY = '__convexAuthRefreshToken';
const RETURN_PATH_KEY = '__convexAuthReturnPath';

function storageKey(key: string): string {
	const escaped = PUBLIC_CONVEX_URL.replace(/[^a-zA-Z0-9]/g, '');
	return `${key}_${escaped}`;
}

export function storageGet(key: string): string | null {
	if (!browser) return null;
	return localStorage.getItem(storageKey(key));
}

export function storageSet(key: string, value: string): void {
	if (!browser) return;
	localStorage.setItem(storageKey(key), value);
}

export function storageRemove(key: string): void {
	if (!browser) return;
	localStorage.removeItem(storageKey(key));
}

// High-level helpers
export function readStoredToken(): string | null {
	return storageGet(JWT_KEY);
}

export function writeTokens(jwt: string, refreshToken?: string): void {
	storageSet(JWT_KEY, jwt);
	if (refreshToken) storageSet(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens(): void {
	storageRemove(JWT_KEY);
	storageRemove(REFRESH_TOKEN_KEY);
}

export function readRefreshToken(): string | null {
	return storageGet(REFRESH_TOKEN_KEY);
}

export function consumeVerifier(): string | undefined {
	const verifier = storageGet(VERIFIER_KEY) ?? undefined;
	storageRemove(VERIFIER_KEY);
	return verifier;
}

export function storeVerifier(verifier: string): void {
	storageSet(VERIFIER_KEY, verifier);
}

export function consumeReturnPath(): string | null {
	const path = storageGet(RETURN_PATH_KEY);
	storageRemove(RETURN_PATH_KEY);
	return path;
}

export function storeReturnPath(path: string): void {
	storageSet(RETURN_PATH_KEY, path);
}

export { JWT_KEY, REFRESH_TOKEN_KEY, VERIFIER_KEY, RETURN_PATH_KEY };
