/**
 * Shared contract for scripts/check-auth-health.mjs (GitHub Auth Canary).
 * After fetch follows redirects, the session probe must see a final status here — not 308 (apex→www).
 */

export const AUTH_CANARY_PROBE = /** @type {const} */ ({
	AUTH_PAGE: 'auth_page',
	GET_SESSION: 'get_session'
});

/** @typedef {(typeof AUTH_CANARY_PROBE)[keyof typeof AUTH_CANARY_PROBE]} AuthCanaryProbeName */
/** @typedef {{ name: AuthCanaryProbeName; status: number }} AuthCanaryProbeResult */
/** @typedef {{ name: AuthCanaryProbeName; run: () => Promise<number> }} AuthCanaryProbeDefinition */

/** Per-probe `fetch` budget (cold starts / edge latency). */
export const AUTH_CANARY_PROBE_TIMEOUT_MS = 20_000;

/**
 * @param {number} status
 */
export function isFinalGetSessionProbeOk(status) {
	return status === 200 || status === 401;
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
