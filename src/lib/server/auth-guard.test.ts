import { describe, expect, it } from 'vitest';
import { buildAuthRedirectTarget } from './auth-guard.js';

describe('auth guard redirect helper', () => {
	it('redirects unauthenticated requests to /auth with a redirect target', () => {
		expect(buildAuthRedirectTarget('/app', '')).toBe('/auth?redirectTo=%2Fapp');
	});

	it('preserves the current path and query string', () => {
		expect(buildAuthRedirectTarget('/app/credits', '?plan=starter&source=nav')).toBe(
			'/auth?redirectTo=%2Fapp%2Fcredits%3Fplan%3Dstarter%26source%3Dnav'
		);
	});
});
