import type { ServerLoadEvent } from "@sveltejs/kit";
import { getProtectedSessionBootstrap } from "$lib/auth/protected-session.js";

export const load = async ({ locals }: ServerLoadEvent) => {
  return {
    authState: getProtectedSessionBootstrap(locals.token),
  };
};
