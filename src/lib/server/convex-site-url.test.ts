import { describe, expect, it } from 'vitest';
import {
	deriveConvexSiteUrlFromPublicConvexUrl,
	resolveConvexSiteUrlForAuthProxy
} from './convex-site-url.js';

describe('deriveConvexSiteUrlFromPublicConvexUrl', () => {
	it('maps convex.cloud to convex.site', () => {
		expect(
			deriveConvexSiteUrlFromPublicConvexUrl('https://vibrant-llama-123.convex.cloud')
		).toBe('https://vibrant-llama-123.convex.site');
	});

	it('accepts origin-only cloud urls with a trailing slash', () => {
		expect(
			deriveConvexSiteUrlFromPublicConvexUrl('https://vibrant-llama-123.convex.cloud/')
		).toBe('https://vibrant-llama-123.convex.site');
	});

	it('returns null for local Convex URL', () => {
		expect(deriveConvexSiteUrlFromPublicConvexUrl('http://127.0.0.1:3210')).toBeNull();
	});

	it('returns null for cloud urls that are not origin-only', () => {
		expect(deriveConvexSiteUrlFromPublicConvexUrl('https://vibrant-llama-123.convex.cloud/api')).toBeNull();
	});
});

describe('resolveConvexSiteUrlForAuthProxy', () => {
	it('derives from PUBLIC_CONVEX_URL when cloud', () => {
		expect(
			resolveConvexSiteUrlForAuthProxy({
				publicConvexUrl: 'https://abc.convex.cloud',
				publicConvexSiteUrl: undefined
			})
		).toBe('https://abc.convex.site');
	});

	it('rejects mismatched explicit PUBLIC_CONVEX_SITE_URL', () => {
		expect(() =>
			resolveConvexSiteUrlForAuthProxy({
				publicConvexUrl: 'https://abc.convex.cloud',
				publicConvexSiteUrl: 'https://wrong.convex.site'
			})
		).toThrow(/Expected https:\/\/abc\.convex\.site/);
	});

	it('allows matching explicit PUBLIC_CONVEX_SITE_URL', () => {
		expect(
			resolveConvexSiteUrlForAuthProxy({
				publicConvexUrl: 'https://abc.convex.cloud',
				publicConvexSiteUrl: 'https://abc.convex.site'
			})
		).toBe('https://abc.convex.site');
	});

	it('canonicalizes matching explicit PUBLIC_CONVEX_SITE_URL to an origin', () => {
		expect(
			resolveConvexSiteUrlForAuthProxy({
				publicConvexUrl: 'https://abc.convex.cloud',
				publicConvexSiteUrl: 'https://abc.convex.site/'
			})
		).toBe('https://abc.convex.site');
	});

	it('uses PUBLIC_CONVEX_SITE_URL when realtime URL is local', () => {
		expect(
			resolveConvexSiteUrlForAuthProxy({
				publicConvexUrl: 'http://127.0.0.1:3210',
				publicConvexSiteUrl: 'https://abc.convex.site'
			})
		).toBe('https://abc.convex.site');
	});

	it('rejects PUBLIC_CONVEX_SITE_URL values that are not origin-only', () => {
		expect(() =>
			resolveConvexSiteUrlForAuthProxy({
				publicConvexUrl: 'http://127.0.0.1:3210',
				publicConvexSiteUrl: 'https://abc.convex.site/api'
			})
		).toThrow(/origin-only https URL/);
	});

	it('rejects PUBLIC_CONVEX_URL values that are neither cloud nor loopback origins', () => {
		expect(() =>
			resolveConvexSiteUrlForAuthProxy({
				publicConvexUrl: 'https://api.example.com',
				publicConvexSiteUrl: undefined
			})
		).toThrow(/PUBLIC_CONVEX_URL must be either an origin-only https URL on \*\.convex\.cloud or a loopback origin/);
	});

	it('throws when local realtime and no site URL', () => {
		expect(() =>
			resolveConvexSiteUrlForAuthProxy({
				publicConvexUrl: 'http://127.0.0.1:3210',
				publicConvexSiteUrl: undefined
			})
		).toThrow(/Could not determine Convex site URL/);
	});
});
