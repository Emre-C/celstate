import type { ServerLoadEvent } from "@sveltejs/kit";
import { requireAuthKitSession } from "$lib/server/authkit-guard.js";

export const load = async (event: ServerLoadEvent) => {
	requireAuthKitSession(event);

	return {
		protectedSession: { isAuthenticated: true as const },
	};
};
