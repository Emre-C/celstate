import { createSvelteKitHandler } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { env } from "$env/dynamic/public";
import { CANONICAL_AUTH_PUBLIC_ENV } from "$lib/auth/config.js";

const convexSiteUrl = env.PUBLIC_CONVEX_SITE_URL?.trim();

if (!convexSiteUrl) {
  throw new Error(
    `${CANONICAL_AUTH_PUBLIC_ENV.publicConvexSiteUrl} is required for the Better Auth SvelteKit handler`
  );
}

export const { GET, POST } = createSvelteKitHandler({ convexSiteUrl });
