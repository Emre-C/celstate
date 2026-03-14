import { describe, expect, it } from 'vitest';
import { buildAuthProxyRequest } from './auth-proxy.js';

describe('auth proxy request', () => {
	it('forwards the original host and protocol headers to Convex auth', () => {
		const proxiedRequest = buildAuthProxyRequest(
			new Request('https://celstate.com/api/auth/sign-in/social?redirectTo=%2Fapp', {
				method: 'POST',
				headers: {
					origin: 'https://celstate.com'
				}
			}),
			'https://original-jackal-530.convex.site',
			'req-123'
		);

		expect(proxiedRequest.url).toBe(
			'https://original-jackal-530.convex.site/api/auth/sign-in/social?redirectTo=%2Fapp'
		);
		expect(proxiedRequest.headers.get('host')).toBe('original-jackal-530.convex.site');
		expect(proxiedRequest.headers.get('x-forwarded-host')).toBe('celstate.com');
		expect(proxiedRequest.headers.get('x-forwarded-proto')).toBe('https');
		expect(proxiedRequest.headers.get('x-forwarded-port')).toBe('443');
		expect(proxiedRequest.headers.get('origin')).toBe('https://celstate.com');
		expect(proxiedRequest.headers.get('x-request-id')).toBe('req-123');
	});

	it('preserves explicit source ports', () => {
		const proxiedRequest = buildAuthProxyRequest(
			new Request('http://localhost:5173/api/auth/get-session', {
				method: 'GET'
			}),
			'https://original-jackal-530.convex.site'
		);

		expect(proxiedRequest.headers.get('x-forwarded-host')).toBe('localhost:5173');
		expect(proxiedRequest.headers.get('x-forwarded-proto')).toBe('http');
		expect(proxiedRequest.headers.get('x-forwarded-port')).toBe('5173');
	});
});
