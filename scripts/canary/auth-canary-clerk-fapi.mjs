/**
 * Clerk Frontend API (custom domain) health helpers for auth canaries.
 * Derives the FAPI host from the publishable key embedded in /auth HTML.
 */

/** Matches the major Clerk JS bundle loaded in production (see browser network tab). */
export const CLERK_BROWSER_JS_PATH = '/npm/@clerk/clerk-js@6/dist/clerk.browser.js';

const PUBLISHABLE_KEY_PATTERN =
	/"PUBLIC_CLERK_PUBLISHABLE_KEY"\s*:\s*"((?:pk_test|pk_live)_[A-Za-z0-9+/=_-]+)"/;

/**
 * @param {string} publishableKey
 * @returns {string}
 */
export function decodeClerkFrontendApiFromPublishableKey(publishableKey) {
	const trimmed = publishableKey.trim();
	const prefix = trimmed.startsWith('pk_live_')
		? 'pk_live_'
		: trimmed.startsWith('pk_test_')
			? 'pk_test_'
			: null;
	if (!prefix) {
		throw new Error('publishable key must start with pk_live_ or pk_test_');
	}

	const encoded = trimmed.slice(prefix.length);
	if (!encoded) {
		throw new Error('publishable key is missing encoded frontend API segment');
	}

	let decoded;
	try {
		decoded = Buffer.from(encoded, 'base64').toString('utf8');
	} catch (error) {
		throw new Error(
			`publishable key frontend API segment is not valid base64: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const frontendApi = decoded.replace(/\$$/, '').trim();
	if (!frontendApi || frontendApi.includes('/') || frontendApi.includes(' ')) {
		throw new Error('publishable key did not decode to a Clerk frontend API host');
	}

	return frontendApi;
}

/**
 * @param {string} html
 * @returns {string}
 */
export function extractPublishableKeyFromAuthPageHtml(html) {
	const match = PUBLISHABLE_KEY_PATTERN.exec(html);
	if (!match?.[1]) {
		throw new Error('/auth HTML did not embed PUBLIC_CLERK_PUBLISHABLE_KEY');
	}
	return match[1];
}

/**
 * @param {string} frontendApi
 * @returns {string}
 */
export function buildClerkFapiScriptUrl(frontendApi) {
	const host = frontendApi.replace(/^https?:\/\//, '').replace(/\/$/, '');
	return `https://${host}${CLERK_BROWSER_JS_PATH}`;
}

/**
 * @param {Response} response
 * @param {string} bodyText
 * @param {string} scriptUrl
 */
export function assertClerkFapiScriptHealthy(response, bodyText, scriptUrl) {
	if (!response.ok) {
		throw new Error(`Clerk FAPI script ${scriptUrl} returned ${response.status}`);
	}

	const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
	if (!contentType.includes('javascript') && !contentType.includes('text/plain')) {
		throw new Error(
			`Clerk FAPI script ${scriptUrl} returned unexpected content-type: ${contentType || 'missing'}`,
		);
	}

	const bodyPrefix = bodyText.trim().slice(0, 32);
	if (!bodyPrefix.startsWith('!function') && !bodyPrefix.startsWith('(function')) {
		throw new Error(`Clerk FAPI script ${scriptUrl} body does not look like clerk.browser.js`);
	}
}

/**
 * @param {string} publishableKey
 * @param {(url: string, init: RequestInit) => Promise<Response>} fetchImpl
 * @param {AbortSignal} signal
 * @returns {Promise<{ scriptUrl: string; status: number }>}
 */
export async function probeClerkFapiScriptFromPublishableKey(publishableKey, fetchImpl, signal) {
	const frontendApi = decodeClerkFrontendApiFromPublishableKey(publishableKey);
	const scriptUrl = buildClerkFapiScriptUrl(frontendApi);
	let response;
	try {
		response = await fetchImpl(scriptUrl, {
			headers: { accept: '*/*' },
			signal
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Clerk FAPI script fetch failed for ${scriptUrl}: ${detail}`);
	}
	const bodyText = await response.text();
	assertClerkFapiScriptHealthy(response, bodyText, scriptUrl);
	return { scriptUrl, status: response.status };
}

/**
 * @param {string} html
 * @param {(url: string, init: RequestInit) => Promise<Response>} fetchImpl
 * @param {AbortSignal} signal
 */
export async function probeClerkFapiScriptFromAuthPageHtml(html, fetchImpl, signal) {
	const publishableKey = extractPublishableKeyFromAuthPageHtml(html);
	return probeClerkFapiScriptFromPublishableKey(publishableKey, fetchImpl, signal);
}
