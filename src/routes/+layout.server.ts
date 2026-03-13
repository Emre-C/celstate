import type { Cookies } from "@sveltejs/kit";
import { getInitialAuthState } from "$lib/server/auth.js";

export const load = async ({ cookies }: { cookies: Cookies }) => {
  return {
    authState: getInitialAuthState(cookies),
  };
};
