import { describe, expect, it } from 'vitest';
import {
	assertClerkFapiScriptHealthy,
	buildClerkFapiScriptUrl,
	decodeClerkFrontendApiFromPublishableKey,
	extractPublishableKeyFromAuthPageHtml
} from './auth-canary-clerk-fapi.mjs';

describe('decodeClerkFrontendApiFromPublishableKey', () => {
	it('decodes production custom-domain publishable keys', () => {
		expect(decodeClerkFrontendApiFromPublishableKey('pk_live_Y2xlcmsuY2Vsc3RhdGUuY29tJA')).toBe(
			'clerk.celstate.com'
		);
	});

	it('rejects malformed keys', () => {
		expect(() => decodeClerkFrontendApiFromPublishableKey('not-a-clerk-key')).toThrow(
			/pk_live_|pk_test_/
		);
	});
});

describe('extractPublishableKeyFromAuthPageHtml', () => {
	it('reads PUBLIC_CLERK_PUBLISHABLE_KEY from embedded SvelteKit env JSON', () => {
		const html =
			'<script>env: {"PUBLIC_CLERK_PUBLISHABLE_KEY":"pk_live_Y2xlcmsuY2Vsc3RhdGUuY29tJA","PUBLIC_SITE_URL":"https://www.celstate.com"}</script>';
		expect(extractPublishableKeyFromAuthPageHtml(html)).toBe('pk_live_Y2xlcmsuY2Vsc3RhdGUuY29tJA');
	});
});

describe('buildClerkFapiScriptUrl', () => {
	it('builds the clerk-js browser bundle URL', () => {
		expect(buildClerkFapiScriptUrl('clerk.celstate.com')).toBe(
			'https://clerk.celstate.com/npm/@clerk/clerk-js@6/dist/clerk.browser.js'
		);
	});
});

describe('assertClerkFapiScriptHealthy', () => {
	it('accepts a javascript bundle body', () => {
		const response = new Response('!function(){}', {
			status: 200,
			headers: { 'content-type': 'application/javascript' }
		});
		expect(() =>
			assertClerkFapiScriptHealthy(response, '!function(){}', 'https://clerk.example.com/script.js')
		).not.toThrow();
	});

	it('rejects non-ok responses', () => {
		const response = new Response('', { status: 502 });
		expect(() =>
			assertClerkFapiScriptHealthy(response, '', 'https://clerk.example.com/script.js')
		).toThrow(/returned 502/);
	});
});
