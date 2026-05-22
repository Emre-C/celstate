import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { buildAuthInitiateTarget } from "$lib/auth/redirect.js";

/**
 * Server-side guard for HTML routes that require an AuthKit session.
 *
 * Unauthenticated users go straight to `/api/auth/initiate` (then WorkOS AuthKit),
 * not the `/auth` interstitial.
 */
export function requireAuthKitSession(event: RequestEvent): void {
	if (!event.locals.auth?.user) {
		throw redirect(303, buildAuthInitiateTarget(event.url.pathname, event.url.search));
	}
}
