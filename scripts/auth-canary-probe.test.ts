import { describe, expect, it } from 'vitest';
import { isFinalGetSessionProbeOk } from './auth-canary-probe.mjs';

describe('auth canary get-session probe', () => {
	it('accepts 200 and 401 as final status (after redirects)', () => {
		expect(isFinalGetSessionProbeOk(200)).toBe(true);
		expect(isFinalGetSessionProbeOk(401)).toBe(true);
	});

	it('rejects 308 — apex→www must be followed, not treated as success', () => {
		expect(isFinalGetSessionProbeOk(308)).toBe(false);
	});
});
