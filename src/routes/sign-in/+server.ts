import { redirect } from "@sveltejs/kit";
import { authKit } from "@workos/authkit-sveltekit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
	const returnTo = url.searchParams.get("returnTo")?.trim();
	const safeReturnTo =
		returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/app";
	const signInUrl = await authKit.getSignInUrl({ returnTo: safeReturnTo });
	throw redirect(302, signInUrl);
};
