import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import {
	BETTER_AUTH_COOKIE_PREFIX,
	getConvexJwtToken,
	getAuthCookieCandidates,
	getAuthCookieName,
	getAuthTokenFromCookieGetter
} from './auth.js';

const createCookies = (entries: Record<string, string | undefined>) =>
	({
		get: (name: string) => entries[name]
	}) as Cookies;

describe('server auth cookies', () => {
	it('builds the Better Auth Convex cookie name', () => {
		expect(getAuthCookieName(BETTER_AUTH_COOKIE_PREFIX)).toBe('better-auth.convex_jwt');
		expect(getAuthCookieCandidates()).toEqual([
			'better-auth.convex_jwt',
			'__Secure-better-auth.convex_jwt'
		]);
	});

	it('extracts the token from the primary Better Auth cookie', () => {
		const token = getAuthTokenFromCookieGetter((name) => ({
			'better-auth.convex_jwt': name === 'better-auth.convex_jwt' ? 'token-123' : undefined
		}[name]));

		expect(token).toBe('token-123');
	});

	it('falls back to the secure Better Auth cookie name', () => {
		const token = getAuthTokenFromCookieGetter((name) => ({
			'__Secure-better-auth.convex_jwt': name === '__Secure-better-auth.convex_jwt' ? 'secure-token' : undefined
		}[name]));

		expect(token).toBe('secure-token');
	});

	it('returns no token when no Better Auth cookie exists', () => {
		expect(getConvexJwtToken(createCookies({}))).toBeUndefined();
	});

	it('returns the token when the Better Auth cookie exists', () => {
		expect(
			getConvexJwtToken(
				createCookies({
					'better-auth.convex_jwt': 'token-123'
				})
			)
		).toBe('token-123');
	});
});
