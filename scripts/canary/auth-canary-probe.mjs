/**
 * Shared contract for scripts/check-auth-health.mjs (GitHub Auth Canary).
 * After fetch follows redirects, the session probe must see a final status here — not 308 (apex→www).
 */

export const AUTH_CANARY_PROBE = /** @type {const} */ ({
	AUTH_PAGE: 'auth_page',
	GET_SESSION: 'get_session',
	CLERK_FAPI: 'clerk_fapi',
	CLERK_SIGN_IN_WIDGET: 'clerk_sign_in_widget'
});

/** @typedef {(typeof AUTH_CANARY_PROBE)[keyof typeof AUTH_CANARY_PROBE]} AuthCanaryProbeName */
/** @typedef {{ name: AuthCanaryProbeName; status: number }} AuthCanaryProbeResult */
/** @typedef {{ name: AuthCanaryProbeName; run: () => Promise<number> }} AuthCanaryProbeDefinition */

/** Per-probe `fetch` budget (cold starts / edge latency). */
export const AUTH_CANARY_PROBE_TIMEOUT_MS = 20_000;
export const AUTH_CANARY_DIAGNOSTIC_HEADERS = /** @type {const} */ ([
	'cf-ray',
	'server',
	'x-vercel-id',
	'x-request-id',
	'convex-usher',
	'via',
	'content-type'
]);
const AUTH_CANARY_BODY_PREFIX_LENGTH = 180;

/** @param {string} value */
const normalizeDiagnosticValue = (value) => value.replace(/\s+/g, ' ').trim();

/**
 * @param {number} status
 */
export function isFinalGetSessionProbeOk(status) {
	return status === 200;
}

/**
 * @param {Response} response
 * @param {string} [bodyText]
 */
export function formatAuthCanaryResponseDiagnostics(response, bodyText = '') {
	const parts = [];
	if (response.url) {
		parts.push(`final_url=${response.url}`);
	}
	for (const headerName of AUTH_CANARY_DIAGNOSTIC_HEADERS) {
		const value = response.headers.get(headerName);
		if (value) {
			parts.push(`${headerName}=${normalizeDiagnosticValue(value).slice(0, 220)}`);
		}
	}

	const bodyPrefix = normalizeDiagnosticValue(bodyText).slice(0, AUTH_CANARY_BODY_PREFIX_LENGTH);
	if (bodyPrefix) {
		parts.push(`body_prefix=${JSON.stringify(bodyPrefix)}`);
	}

	return parts.length > 0 ? `diagnostics: ${parts.join('; ')}` : 'diagnostics: none';
}

/**
 * @param {AuthCanaryProbeName} probeName
 * @param {unknown} error
 * @param {number} [timeoutMs]
 */
export function formatAuthCanaryProbeFailure(probeName, error, timeoutMs = AUTH_CANARY_PROBE_TIMEOUT_MS) {
	const msg = error instanceof Error ? error.message : String(error);
	const timedOut =
		error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(msg));
	if (timedOut) {
		return `[${probeName}] request timed out after ${timeoutMs}ms`;
	}
	return `[${probeName}] ${msg}`;
}
