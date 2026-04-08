import { describe, expect, it } from 'vitest';
import {
	AUTH_CANARY_PROBE,
	AUTH_CANARY_PROBE_TIMEOUT_MS,
	formatAuthCanaryProbeFailure,
	isFinalGetSessionProbeOk
} from './auth-canary-probe.mjs';

describe('auth canary get-session probe', () => {
	it('accepts 200 and 401 as final status (after redirects)', () => {
		expect(isFinalGetSessionProbeOk(200)).toBe(true);
		expect(isFinalGetSessionProbeOk(401)).toBe(true);
	});

	it('rejects 308 — apex→www must be followed, not treated as success', () => {
		expect(isFinalGetSessionProbeOk(308)).toBe(false);
	});
});

describe('formatAuthCanaryProbeFailure', () => {
	it('maps AbortError to a labeled timeout message', () => {
		const err = new Error('This operation was aborted');
		err.name = 'AbortError';
		expect(formatAuthCanaryProbeFailure(AUTH_CANARY_PROBE.AUTH_PAGE, err)).toBe(
			`[${AUTH_CANARY_PROBE.AUTH_PAGE}] request timed out after ${AUTH_CANARY_PROBE_TIMEOUT_MS}ms`
		);
	});

	it('maps "aborted" message without AbortError name to timeout', () => {
		expect(
			formatAuthCanaryProbeFailure(
				AUTH_CANARY_PROBE.GET_SESSION,
				new Error('This operation was aborted')
			)
		).toBe(
			`[${AUTH_CANARY_PROBE.GET_SESSION}] request timed out after ${AUTH_CANARY_PROBE_TIMEOUT_MS}ms`
		);
	});

	it('prefixes other errors with probe name', () => {
		expect(
			formatAuthCanaryProbeFailure(
				AUTH_CANARY_PROBE.GET_SESSION,
				new Error('/api/auth/get-session returned 500')
			)
		).toBe(`[${AUTH_CANARY_PROBE.GET_SESSION}] /api/auth/get-session returned 500`);
	});
});
