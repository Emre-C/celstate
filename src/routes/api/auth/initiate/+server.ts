import { redirect } from "@sveltejs/kit";
import { authKit } from "@workos/authkit-sveltekit";
import { normalizeAuthReturnTo } from "$lib/auth/redirect.js";
import type { RequestHandler } from "./$types";

/**
 * WorkOS Sign-in endpoint (initiate_login_uri). Not linked from product UI.
 * Used for WorkOS-initiated flows (e.g. dashboard impersonation) that must
 * enter the app before redirecting to AuthKit so PKCE/state are established.
 */
export const GET: RequestHandler = async ({ url }) => {
	const returnTo = normalizeAuthReturnTo(url.searchParams.get("returnTo"));
	const signInUrl = await authKit.getSignInUrl({ returnTo });
	throw redirect(302, signInUrl);
};
