import type { ServerLoadEvent } from "@sveltejs/kit";
import { requireClerkSession } from "$lib/server/clerk-guard.js";

export const load = async (event: ServerLoadEvent) => {
	requireClerkSession(event);

	return {
		protectedSession: { isAuthenticated: true as const },
	};
};
