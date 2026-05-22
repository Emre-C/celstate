import { redirect } from "@sveltejs/kit";
import { authKit } from "@workos/authkit-sveltekit";
import {
	buildAuthInitiateTargetFromReturnTo,
	normalizeAuthReturnTo,
} from "$lib/auth/redirect.js";
import { getAuthProviderDescriptors } from "$lib/auth/providers.js";
import type { PageServerLoad } from "./$types";

/**
 * `/auth` is for sign-in errors and recovery only. Healthy sign-in starts at
 * `/api/auth/initiate` (or direct AuthKit URL below).
 */
export const load: PageServerLoad = async ({ url }) => {
	const returnTo = normalizeAuthReturnTo(url.searchParams.get("redirectTo"));
	const authError = url.searchParams.get("error")?.trim() ?? "";

	if (!authError) {
		const signInUrl = await authKit.getSignInUrl({ returnTo });
		redirect(302, signInUrl);
	}

	return {
		returnTo,
		authError,
		retryHref: buildAuthInitiateTargetFromReturnTo(returnTo),
		providers: getAuthProviderDescriptors(),
	};
};
