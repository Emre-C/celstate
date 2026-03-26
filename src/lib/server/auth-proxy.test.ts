import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_PROXY_CLIENT_IP_HEADER } from '../auth/config.js';
import {
	buildAuthProxyRequest,
	isRetryableUpstreamFetchError,
	proxyAuthRequest
} from './auth-proxy.js';

vi.mock('@sentry/sveltekit', () => ({
	captureMessage: vi.fn()
}));

describe('isRetryableUpstreamFetchError', () => {
	it('treats TypeError fetch failed as retryable', () => {
		expect(isRetryableUpstreamFetchError(new TypeError('fetch failed'))).toBe(true);
	});

	it('does not treat AbortError as retryable', () => {
		expect(isRetryableUpstreamFetchError(new DOMException('aborted', 'AbortError'))).toBe(false);
	});

	it('treats ConnectTimeoutError in cause as retryable', () => {
		const cause = new Error('connect timeout');
		cause.name = 'ConnectTimeoutError';
		const err = new TypeError('fetch failed');
		Object.assign(err, { cause });
		expect(isRetryableUpstreamFetchError(err)).toBe(true);
	});
});

describe('proxyAuthRequest', () => {
	const convexUrl = 'https://example.convex.site';

	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('returns upstream response on success', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('ok', { status: 200 }));
		const req = new Request('http://localhost/api/auth/session', { method: 'GET' });
		const res = await proxyAuthRequest(req, convexUrl);
		expect(res.status).toBe(200);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('removes stale compression headers from upstream fetch responses', async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response('ok', {
				status: 200,
				headers: {
					'content-encoding': 'gzip',
					'content-length': '99',
					'content-type': 'application/json'
				}
			})
		);

		const req = new Request('http://localhost/api/auth/get-session', { method: 'GET' });
		const res = await proxyAuthRequest(req, convexUrl);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-encoding')).toBeNull();
		expect(res.headers.get('content-length')).toBeNull();
		expect(res.headers.get('content-type')).toBe('application/json');
		expect(await res.text()).toBe('ok');
	});

	it('retries GET on transient failure then succeeds', async () => {
		vi.mocked(fetch)
			.mockRejectedValueOnce(new TypeError('fetch failed'))
			.mockResolvedValueOnce(new Response('ok', { status: 200 }));
		const req = new Request('http://localhost/api/auth/convex/token', { method: 'GET' });
		const res = await proxyAuthRequest(req, convexUrl);
		expect(res.status).toBe(200);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('returns 503 JSON after exhausting retries', async () => {
		vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));
		const req = new Request('http://localhost/api/auth/convex/token', { method: 'GET' });
		const res = await proxyAuthRequest(req, convexUrl);
		expect(res.status).toBe(503);
		expect(await res.json()).toMatchObject({ error: 'auth_backend_unavailable' });
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('does not retry POST', async () => {
		vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));
		const req = new Request('http://localhost/api/auth/sign-in', {
			method: 'POST',
			body: '{}',
			headers: { 'content-type': 'application/json' }
		});
		const res = await proxyAuthRequest(req, convexUrl);
		expect(res.status).toBe(503);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('rethrows AbortError', async () => {
		vi.mocked(fetch).mockRejectedValue(new DOMException('aborted', 'AbortError'));
		const req = new Request('http://localhost/api/auth/session', { method: 'GET' });
		await expect(proxyAuthRequest(req, convexUrl)).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('aborts during retry backoff when the client disconnects', async () => {
		vi.useFakeTimers();
		vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
		const controller = new AbortController();
		const req = new Request('http://localhost/api/auth/session', {
			method: 'GET',
			signal: controller.signal
		});

		const promise = proxyAuthRequest(req, convexUrl);
		const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
		await Promise.resolve();
		controller.abort();
		await vi.runAllTimersAsync();

		await assertion;
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

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
			{
				clientIp: '203.0.113.10',
				requestId: 'req-123'
			}
		);

		expect(proxiedRequest.url).toBe(
			'https://original-jackal-530.convex.site/api/auth/sign-in/social?redirectTo=%2Fapp'
		);
		expect(proxiedRequest.headers.get('host')).toBe('original-jackal-530.convex.site');
		expect(proxiedRequest.headers.get('x-forwarded-host')).toBe('celstate.com');
		expect(proxiedRequest.headers.get('x-forwarded-for')).toBe('203.0.113.10');
		expect(proxiedRequest.headers.get('x-forwarded-proto')).toBe('https');
		expect(proxiedRequest.headers.get('x-forwarded-port')).toBe('443');
		expect(proxiedRequest.headers.get('origin')).toBe('https://celstate.com');
		expect(proxiedRequest.headers.get(AUTH_PROXY_CLIENT_IP_HEADER)).toBe('203.0.113.10');
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

	it('replaces caller-controlled forwarding headers with trusted proxy values', () => {
		const proxiedRequest = buildAuthProxyRequest(
			new Request('https://celstate.com/api/auth/get-session', {
				method: 'GET',
				headers: {
					'accept-encoding': 'gzip',
					forwarded: 'for=198.51.100.20;host=evil.example;proto=http',
					host: 'evil.example',
					'x-forwarded-for': '198.51.100.20',
					'x-forwarded-host': 'evil.example',
					'x-forwarded-port': '81',
					'x-forwarded-proto': 'http',
					'x-real-ip': '198.51.100.21',
					'x-request-id': 'evil-request-id',
					[AUTH_PROXY_CLIENT_IP_HEADER]: '198.51.100.22'
				}
			}),
			'https://original-jackal-530.convex.site',
			{
				clientIp: '203.0.113.10',
				requestId: 'req-123'
			}
		);

		expect(proxiedRequest.headers.get('accept-encoding')).toBeNull();
		expect(proxiedRequest.headers.get('forwarded')).toBeNull();
		expect(proxiedRequest.headers.get('host')).toBe('original-jackal-530.convex.site');
		expect(proxiedRequest.headers.get('x-forwarded-for')).toBe('203.0.113.10');
		expect(proxiedRequest.headers.get('x-forwarded-host')).toBe('celstate.com');
		expect(proxiedRequest.headers.get('x-forwarded-port')).toBe('443');
		expect(proxiedRequest.headers.get('x-forwarded-proto')).toBe('https');
		expect(proxiedRequest.headers.get('x-real-ip')).toBeNull();
		expect(proxiedRequest.headers.get('x-request-id')).toBe('req-123');
		expect(proxiedRequest.headers.get(AUTH_PROXY_CLIENT_IP_HEADER)).toBe('203.0.113.10');
	});
});
