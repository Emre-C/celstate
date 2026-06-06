import { redirect } from "@sveltejs/kit";
import { normalizeAuthReturnTo } from "$lib/auth/redirect.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
	const returnTo = normalizeAuthReturnTo(url.searchParams.get("returnTo"));
	throw redirect(302, `/auth?redirectTo=${encodeURIComponent(returnTo)}`);
};
