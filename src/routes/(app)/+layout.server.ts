import { redirect } from "@sveltejs/kit";
import type { ServerLoadEvent } from "@sveltejs/kit";
import { buildAuthRedirectTarget } from "$lib/auth/redirect.js";
import { getInitialAuthState } from "$lib/server/auth.js";

export const load = async ({ cookies, locals, url }: ServerLoadEvent) => {
  if (!locals.token) {
    throw redirect(303, buildAuthRedirectTarget(url.pathname, url.search));
  }

  return {
    authState: getInitialAuthState(cookies),
  };
};
