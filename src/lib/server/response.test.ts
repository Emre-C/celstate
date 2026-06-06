import { describe, expect, it } from 'vitest';
import { withResponseHeader } from './response.js';

const SESSION_COOKIE = '__session';

describe('withResponseHeader', () => {
	it('adds headers to redirect responses without mutating immutable headers', () => {
		const response = withResponseHeader(
			Response.redirect('https://www.celstate.com/auth?redirectTo=%2Fapp', 308),
			'x-request-id',
			'req-123'
		);

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe('https://www.celstate.com/auth?redirectTo=%2Fapp');
		expect(response.headers.get('x-request-id')).toBe('req-123');
	});

	it('adds headers to fetched immutable responses while preserving the body', async () => {
		const fetchedResponse = await fetch('data:text/plain,ok');
		const response = withResponseHeader(fetchedResponse, 'x-request-id', 'req-456');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/plain');
		expect(response.headers.get('x-request-id')).toBe('req-456');
		expect(await response.text()).toBe('ok');
	});

	it('preserves multiple Set-Cookie headers without comma-joining', () => {
		const original = new Response(null, {
			status: 302,
			headers: {
				Location: '/auth',
				'Set-Cookie': `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly`,
			},
		});
		// Simulate a second Set-Cookie header appended via Headers API
		original.headers.append('Set-Cookie', 'wos-auth-verifier-abc=; Max-Age=0; Path=/');

		const response = withResponseHeader(original, 'x-request-id', 'req-789');

		const cookies = response.headers.getSetCookie();
		expect(cookies).toHaveLength(2);
		expect(cookies[0]).toContain(`${SESSION_COOKIE}=`);
		expect(cookies[1]).toContain('wos-auth-verifier-abc=');
		expect(response.headers.get('x-request-id')).toBe('req-789');
	});
});
