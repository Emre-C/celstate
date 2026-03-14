import type { RequestHandler } from "@sveltejs/kit";
import { env } from "$env/dynamic/public";
import { CANONICAL_AUTH_PUBLIC_ENV } from "$lib/auth/config.js";
import { proxyAuthRequest } from "$lib/server/auth-proxy.js";

const convexSiteUrl = env.PUBLIC_CONVEX_SITE_URL?.trim();

if (!convexSiteUrl) {
  throw new Error(
    `${CANONICAL_AUTH_PUBLIC_ENV.publicConvexSiteUrl} is required for the Better Auth SvelteKit handler`
  );
}

const handleAuthProxy: RequestHandler = async ({ request, locals }) => {
  return proxyAuthRequest(request, convexSiteUrl, locals.requestId);
};

export const GET = handleAuthProxy;
export const POST = handleAuthProxy;
