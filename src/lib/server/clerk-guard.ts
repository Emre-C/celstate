import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { buildAuthInitiateTarget } from "$lib/auth/redirect.js";

export function requireClerkSession(event: RequestEvent): void {
	if (!event.locals.auth().userId) {
		throw redirect(303, buildAuthInitiateTarget(event.url.pathname, event.url.search));
	}
}
