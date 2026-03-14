import { describe, expect, it } from 'vitest';
import { withResponseHeader } from './response.js';

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
});
