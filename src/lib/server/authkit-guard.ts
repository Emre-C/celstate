import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { buildAuthRedirectTarget } from "$lib/auth/redirect.js";

/**
 * Server-side guard for HTML routes that require an AuthKit session.
 *
 * Matches {@link authKit.withAuth} (requires `locals.auth.user`) but preserves
 * pathname + query in `redirectTo` — the stock helper only forwards pathname.
 */
export function requireAuthKitSession(event: RequestEvent): void {
	if (!event.locals.auth?.user) {
		throw redirect(303, buildAuthRedirectTarget(event.url.pathname, event.url.search));
	}
}
