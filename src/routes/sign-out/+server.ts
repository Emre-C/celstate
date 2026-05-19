import { authKit } from "@workos/authkit-sveltekit";
import { AUTHKIT_SESSION_COOKIE } from "$lib/server/authkit-constants.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
	// Explicitly clear the local session cookie as a safeguard.
	// The SDK's authKit.signOut also emits a clear-cookie, but we
	// double-cover in case of path/domain mismatches or SDK bugs.
	event.cookies.delete(AUTHKIT_SESSION_COOKIE, { path: "/" });

	// Invalidate the WorkOS server-side session and redirect to
	// WorkOS logout URL (which will eventually bring the user back).
	return authKit.signOut(event);
};
