import { describe, expect, it } from 'vitest';
import { resolveAuthClientBaseUrl } from './auth-client.js';

describe('auth client base url', () => {
	it('normalizes absolute public site urls to their origin', () => {
		expect(resolveAuthClientBaseUrl({ publicSiteUrl: 'https://celstate.app/api/auth' })).toBe(
			'https://celstate.app'
		);
	});

	it('falls back to the browser origin when the public site url is not absolute', () => {
		expect(
			resolveAuthClientBaseUrl({
				publicSiteUrl: '/api/auth',
				browserOrigin: 'http://localhost:5174'
			})
		).toBe('http://localhost:5174');
	});

	it('falls back to the default local site url when no absolute url is available', () => {
		expect(resolveAuthClientBaseUrl({ publicSiteUrl: '', browserOrigin: '' })).toBe(
			'http://localhost:5173'
		);
	});
});
