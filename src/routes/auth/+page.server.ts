import { normalizeAuthReturnTo } from "$lib/auth/redirect.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
	const returnTo = normalizeAuthReturnTo(url.searchParams.get("redirectTo"));
	const authError = url.searchParams.get("error")?.trim() ?? "";

	return {
		returnTo,
		authError,
	};
};
