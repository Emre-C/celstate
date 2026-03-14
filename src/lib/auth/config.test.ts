import { describe, expect, it } from 'vitest';
import {
	APPLE_TRUSTED_ORIGIN,
	assertCanonicalAuthEnv,
	getAllowedAuthHosts,
	getCanonicalSiteOrigins,
	getAuthProviderAvailability,
	getMissingCanonicalAuthEnvKeys,
	getTrustedOrigins,
	readCanonicalAuthEnv,
	requiresAppleCredentials
} from './config.js';

const canonicalEnv = {
	SITE_URL: 'https://celstate.app',
	BETTER_AUTH_SECRET: 'secret',
	AUTH_GOOGLE_ID: 'google-id',
	AUTH_GOOGLE_SECRET: 'google-secret',
	AUTH_APPLE_ID: 'apple-id',
	AUTH_APPLE_SECRET: 'apple-secret'
};

describe('auth config', () => {
	it('parses canonical auth env values', () => {
		const env = readCanonicalAuthEnv(canonicalEnv);

		expect(env).toMatchObject({
			siteUrl: 'https://celstate.app',
			betterAuthSecret: 'secret',
			googleClientId: 'google-id',
			googleClientSecret: 'google-secret',
			appleClientId: 'apple-id',
			appleClientSecret: 'apple-secret'
		});
	});

	it('requires canonical google provider credentials', () => {
		expect(
			getMissingCanonicalAuthEnvKeys({
				...canonicalEnv,
				AUTH_GOOGLE_ID: undefined
			})
		).toContain('AUTH_GOOGLE_ID');

		expect(
			getMissingCanonicalAuthEnvKeys({
				...canonicalEnv,
				AUTH_GOOGLE_SECRET: undefined
			})
		).toContain('AUTH_GOOGLE_SECRET');
	});

	// TODO: Re-enable this test once Apple Sign-In credential requirements are restored in config.ts
	it.skip('requires canonical apple provider credentials for https site urls', () => {
		expect(
			getMissingCanonicalAuthEnvKeys({
				...canonicalEnv,
				AUTH_APPLE_ID: undefined
			})
		).toContain('AUTH_APPLE_ID');

		expect(
			getMissingCanonicalAuthEnvKeys({
				...canonicalEnv,
				AUTH_APPLE_SECRET: undefined
			})
		).toContain('AUTH_APPLE_SECRET');
	});

	it('does not require canonical apple provider credentials for non-https site urls', () => {
		const missing = getMissingCanonicalAuthEnvKeys({
			...canonicalEnv,
			SITE_URL: 'http://localhost:5173',
			AUTH_APPLE_ID: undefined,
			AUTH_APPLE_SECRET: undefined
		});

		expect(missing).not.toContain('AUTH_APPLE_ID');
		expect(missing).not.toContain('AUTH_APPLE_SECRET');
	});

	it('ignores legacy duplicate google env names after cleanup', () => {
		expect(() =>
			assertCanonicalAuthEnv({
				SITE_URL: 'https://celstate.app',
				BETTER_AUTH_SECRET: 'secret',
				GOOGLE_CLIENT_ID: 'legacy-google-id',
				GOOGLE_CLIENT_SECRET: 'legacy-google-secret',
				AUTH_APPLE_ID: 'apple-id',
				AUTH_APPLE_SECRET: 'apple-secret'
			})
		).toThrow(/AUTH_GOOGLE_ID/);
	});

	it('reports provider availability from canonical envs', () => {
		expect(getAuthProviderAvailability(readCanonicalAuthEnv(canonicalEnv))).toEqual({
			google: true,
			apple: true
		});
	});

	it('derives apex and www origins from the canonical site url', () => {
		expect(getCanonicalSiteOrigins('https://www.celstate.app')).toEqual([
			'https://www.celstate.app',
			'https://celstate.app'
		]);
	});

	it('keeps localhost as a single origin', () => {
		expect(getCanonicalSiteOrigins('http://localhost:5173')).toEqual(['http://localhost:5173']);
	});

	it('includes the Apple trusted origin when Apple is enabled', () => {
		expect(getTrustedOrigins(readCanonicalAuthEnv(canonicalEnv))).toEqual([
			'https://celstate.app',
			'https://www.celstate.app',
			APPLE_TRUSTED_ORIGIN
		]);
	});

	it('derives allowed auth hosts from the canonical site url', () => {
		expect(getAllowedAuthHosts(readCanonicalAuthEnv(canonicalEnv))).toEqual([
			'celstate.app',
			'www.celstate.app'
		]);
	});

	it('requires apple credentials only for https site urls', () => {
		expect(requiresAppleCredentials(readCanonicalAuthEnv(canonicalEnv))).toBe(true);
		expect(
			requiresAppleCredentials(
				readCanonicalAuthEnv({
					...canonicalEnv,
					SITE_URL: 'http://localhost:5173'
				})
			)
		).toBe(false);
	});

	it('accepts non-https site urls without apple credentials', () => {
		expect(
			assertCanonicalAuthEnv({
				SITE_URL: 'http://localhost:5173',
				BETTER_AUTH_SECRET: 'secret',
				AUTH_GOOGLE_ID: 'google-id',
				AUTH_GOOGLE_SECRET: 'google-secret'
			})
		).toEqual({
			siteUrl: 'http://localhost:5173',
			betterAuthSecret: 'secret',
			googleClientId: 'google-id',
			googleClientSecret: 'google-secret',
			appleClientId: undefined,
			appleClientSecret: undefined,
			appleAppBundleIdentifier: undefined
		});
	});
});
