import { describe, expect, it } from 'vitest';
import {
	AUTH_CANARY_PROBE,
	AUTH_CANARY_PROBE_TIMEOUT_MS,
	formatAuthCanaryResponseDiagnostics,
	formatAuthCanaryProbeFailure,
	isFinalGetSessionProbeOk
} from './auth-canary-probe.mjs';

describe('auth canary session probe', () => {
	it('accepts only 200 as final status (after redirects)', () => {
		expect(isFinalGetSessionProbeOk(200)).toBe(true);
		expect(isFinalGetSessionProbeOk(401)).toBe(false);
	});

	it('rejects 308 — apex→www must be followed, not treated as success', () => {
		expect(isFinalGetSessionProbeOk(308)).toBe(false);
	});
});

describe('formatAuthCanaryResponseDiagnostics', () => {
	it('includes only safe response details for edge/origin failures', () => {
		const response = new Response('<html>\n  Cloudflare 520\n</html>', {
			status: 520,
			headers: {
				'cf-ray': 'ray-123-IAD',
				'content-type': 'text/html',
				'server': 'cloudflare',
				'set-cookie': 'secret=do-not-log',
				'x-vercel-id': 'iad1::abc'
			}
		});
		Object.defineProperty(response, 'url', {
			value: 'https://www.celstate.com/api/auth/session'
		});

		const diagnostics = formatAuthCanaryResponseDiagnostics(response, '<html>\n  Cloudflare 520\n</html>');

		expect(diagnostics).toContain('final_url=https://www.celstate.com/api/auth/session');
		expect(diagnostics).toContain('cf-ray=ray-123-IAD');
		expect(diagnostics).toContain('server=cloudflare');
		expect(diagnostics).toContain('x-vercel-id=iad1::abc');
		expect(diagnostics).toContain('content-type=text/html');
		expect(diagnostics).toContain('body_prefix="<html> Cloudflare 520 </html>"');
		expect(diagnostics).not.toContain('set-cookie');
		expect(diagnostics).not.toContain('secret=do-not-log');
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
				new Error('/api/auth/session returned 500')
			)
		).toBe(`[${AUTH_CANARY_PROBE.GET_SESSION}] /api/auth/session returned 500`);
	});
});
