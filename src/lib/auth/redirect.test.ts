import { describe, expect, it } from 'vitest';
import {
	buildAuthInitiateTarget,
	buildAuthPageTarget,
	normalizeAuthReturnTo,
} from './redirect.js';

describe('auth redirect helpers', () => {
	it('builds initiate URL for protected routes', () => {
		expect(buildAuthInitiateTarget('/app', '')).toBe('/api/auth/initiate?returnTo=%2Fapp');
	});

	it('preserves path and query in initiate URL', () => {
		expect(buildAuthInitiateTarget('/app/credits', '?plan=starter&source=nav')).toBe(
			'/api/auth/initiate?returnTo=%2Fapp%2Fcredits%3Fplan%3Dstarter%26source%3Dnav'
		);
	});

	it('builds auth recovery page URL with error', () => {
		expect(buildAuthPageTarget('/app', { error: 'state_mismatch' })).toBe(
			'/auth?redirectTo=%2Fapp&error=state_mismatch'
		);
	});

	it('normalizes safe in-app return paths', () => {
		expect(normalizeAuthReturnTo('/app/credits')).toBe('/app/credits');
		expect(normalizeAuthReturnTo('  /app  ')).toBe('/app');
	});

	it('rejects protocol-relative and off-site return paths', () => {
		expect(normalizeAuthReturnTo('//evil.com')).toBe('/app');
		expect(normalizeAuthReturnTo('https://evil.com')).toBe('/app');
		expect(normalizeAuthReturnTo(null)).toBe('/app');
		expect(normalizeAuthReturnTo('')).toBe('/app');
	});
});
