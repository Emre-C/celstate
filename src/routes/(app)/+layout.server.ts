import { redirect } from "@sveltejs/kit";
import type { ServerLoadEvent } from "@sveltejs/kit";
import { resolveProtectedSessionRequest } from "$lib/auth/protected-session.js";

export const load = async ({ locals, url }: ServerLoadEvent) => {
	const protectedSession = resolveProtectedSessionRequest({
		pathname: url.pathname,
		search: url.search,
		token: locals.token
	});

	if (protectedSession.kind === 'redirect') {
		throw redirect(303, protectedSession.location);
	}

	return {
		protectedSession: protectedSession.bootstrap
	};
};
