import { describe, expect, it } from 'vitest';
import { createCanonicalRedirectResponse, getCanonicalRedirectUrl } from './canonical-site.js';

describe('canonical site redirect', () => {
	it('redirects apex requests to the configured canonical host', () => {
		expect(
			getCanonicalRedirectUrl({
				requestUrl: 'https://celstate.com/auth?redirectTo=%2Fapp',
				publicSiteUrl: 'https://www.celstate.com'
			})
		).toBe('https://www.celstate.com/auth?redirectTo=%2Fapp');
	});

	it('does not redirect when already on the canonical origin', () => {
		expect(
			getCanonicalRedirectUrl({
				requestUrl: 'https://www.celstate.com/auth?redirectTo=%2Fapp',
				publicSiteUrl: 'https://www.celstate.com'
			})
		).toBeUndefined();
	});

	it('ignores missing or invalid canonical site urls', () => {
		expect(
			getCanonicalRedirectUrl({
				requestUrl: 'https://celstate.com/auth',
				publicSiteUrl: ''
			})
		).toBeUndefined();
		expect(
			getCanonicalRedirectUrl({
				requestUrl: 'https://celstate.com/auth',
				publicSiteUrl: '/auth'
			})
		).toBeUndefined();
	});

	it('builds a redirect response with request tracing headers', () => {
		const response = createCanonicalRedirectResponse(
			'https://www.celstate.com/auth?redirectTo=%2Fapp',
			'req-123'
		);

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe('https://www.celstate.com/auth?redirectTo=%2Fapp');
		expect(response.headers.get('x-request-id')).toBe('req-123');
	});
});
