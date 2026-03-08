/**
 * Auth Contract Smoke Test
 *
 * Validates that the @convex-dev/auth server action API contract
 * matches what our custom Svelte auth client (src/lib/auth/auth.svelte.ts)
 * expects. Run after any dependency update to catch breaking changes
 * before they hit the browser.
 *
 * Usage:
 *   npx tsx scripts/test-auth-contract.ts
 *
 * Requires:
 *   - CONVEX_URL env var (or reads from .env.local)
 *   - Convex dev deployment running with auth configured
 *
 * What this tests:
 *   1. auth:signIn accepts {provider, params: {redirectTo}} and returns {redirect, verifier}
 *   2. auth:signIn accepts {refreshToken} for token refresh (expects graceful failure with invalid token)
 *   3. auth:signOut accepts {} without throwing
 *
 * What this does NOT test:
 *   - Actual OAuth flow (requires browser + Google)
 *   - Token exchange with real code+verifier (requires completed OAuth)
 */

import { ConvexHttpClient } from 'convex/browser';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// --- Resolve Convex URL ---
function getConvexUrl(): string {
	if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
	if (process.env.PUBLIC_CONVEX_URL) return process.env.PUBLIC_CONVEX_URL;

	// Try .env.local
	const envPath = resolve(process.cwd(), '.env.local');
	if (existsSync(envPath)) {
		const content = readFileSync(envPath, 'utf-8');
		const match = content.match(/PUBLIC_CONVEX_URL\s*=\s*["']?([^\s"']+)/);
		if (match) return match[1];
	}

	throw new Error(
		'No Convex URL found. Set CONVEX_URL or PUBLIC_CONVEX_URL env var, or create .env.local'
	);
}

// --- Test runner ---
let passed = 0;
let failed = 0;

function ok(name: string) {
	passed++;
	console.log(`  ✅ ${name}`);
}
function fail(name: string, reason: string) {
	failed++;
	console.error(`  ❌ ${name}: ${reason}`);
}

async function main() {
	const url = getConvexUrl();
	console.log(`\n🔍 Auth contract smoke test against: ${url}\n`);

	const client = new ConvexHttpClient(url);

	// --- Test 1: signIn with OAuth provider returns redirect + verifier ---
	console.log('Test 1: auth:signIn with {provider, params: {redirectTo}}');
	try {
		const result: any = await client.action('auth:signIn' as any, {
			provider: 'google',
			params: { redirectTo: '/auth/callback' },
		});

		if (typeof result !== 'object' || result === null) {
			fail('response is object', `got ${typeof result}`);
		} else {
			if (typeof result.redirect === 'string' && result.redirect.length > 0) {
				ok('response.redirect is a non-empty string');
			} else {
				fail('response.redirect', `got ${JSON.stringify(result.redirect)}`);
			}

			if (typeof result.verifier === 'string' && result.verifier.length > 0) {
				ok('response.verifier is a non-empty string');
			} else {
				fail('response.verifier', `got ${JSON.stringify(result.verifier)}`);
			}

			// Should NOT have tokens (OAuth requires browser redirect)
			if (result.tokens === undefined || result.tokens === null) {
				ok('response.tokens is absent (expected for OAuth redirect flow)');
			} else {
				fail('response.tokens', `unexpectedly present: ${JSON.stringify(result.tokens)}`);
			}
		}
	} catch (e: any) {
		fail('signIn action call', e.message ?? String(e));
	}

	// --- Test 2: signIn with invalid refreshToken fails gracefully ---
	console.log('\nTest 2: auth:signIn with {refreshToken} (invalid token)');
	try {
		const result: any = await client.action('auth:signIn' as any, {
			refreshToken: 'invalid-token-for-contract-test',
		});

		// Either returns null/empty tokens, or throws — both are acceptable
		// The key contract: the action ACCEPTS the {refreshToken} field shape
		if (result?.tokens) {
			fail('should not return valid tokens for garbage refresh token', JSON.stringify(result.tokens));
		} else {
			ok('action accepted {refreshToken} shape and returned no valid tokens');
		}
	} catch (e: any) {
		// A server error is fine — it means the action accepted the field shape
		// but correctly rejected the invalid token
		if (e.message?.includes('ArgumentValidationError')) {
			fail('refreshToken field rejected by validator', 'API contract changed — refreshToken no longer accepted at top level');
		} else {
			ok('action accepted {refreshToken} shape (threw on invalid value, which is correct)');
		}
	}

	// --- Test 3: signOut accepts empty args ---
	console.log('\nTest 3: auth:signOut with {}');
	try {
		await client.action('auth:signOut' as any, {});
		ok('signOut accepted {} without throwing');
	} catch (e: any) {
		if (e.message?.includes('ArgumentValidationError')) {
			fail('signOut argument shape', 'API contract changed — {} no longer accepted');
		} else {
			// Other errors (e.g., "not authenticated") are fine — shape was accepted
			ok('signOut accepted {} shape (non-validation error is expected when not authenticated)');
		}
	}

	// --- Test 4: signIn rejects unknown top-level fields ---
	console.log('\nTest 4: auth:signIn rejects unknown top-level fields (regression guard)');
	try {
		await client.action('auth:signIn' as any, {
			provider: 'google',
			redirectTo: '/auth/callback', // WRONG — this was the bug
		});
		fail('should have rejected redirectTo at top level', 'action accepted it without error');
	} catch (e: any) {
		if (e.message?.includes('redirectTo')) {
			ok('redirectTo at top level correctly rejected (this was the original bug)');
		} else {
			// Any error is acceptable — the point is it shouldn't silently succeed
			ok('action rejected unknown top-level field');
		}
	}

	// --- Summary ---
	console.log(`\n${'─'.repeat(50)}`);
	console.log(`Results: ${passed} passed, ${failed} failed`);
	if (failed > 0) {
		console.error('\n⚠️  AUTH CONTRACT HAS CHANGED. Your custom Svelte auth client may be broken.');
		console.error('   Review @convex-dev/auth changelog and update src/lib/auth/auth.svelte.ts');
		process.exit(1);
	} else {
		console.log('\n✅ Auth contract is stable. Safe to proceed.\n');
	}
}

main();
