import { redirect } from "@sveltejs/kit";
import type { ServerLoadEvent } from "@sveltejs/kit";
import { buildAuthRedirectTarget } from "$lib/server/auth-guard.js";

export const load = async ({ locals, url }: ServerLoadEvent) => {
  if (!locals.token) {
    throw redirect(303, buildAuthRedirectTarget(url.pathname, url.search));
  }

  return {};
};
