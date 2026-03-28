/**
 * Shared contract for scripts/check-auth-health.mjs (GitHub Auth Canary).
 * After fetch follows redirects, the session probe must see a final status here — not 308 (apex→www).
 *
 * @param {number} status
 */
export function isFinalGetSessionProbeOk(status) {
	return status === 200 || status === 401;
}
