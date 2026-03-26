import type { RequestHandler } from "@sveltejs/kit";
import { env } from "$env/dynamic/public";
import { proxyAuthRequest } from "$lib/server/auth-proxy.js";
import { resolveConvexSiteUrlForAuthProxy } from "$lib/server/convex-site-url.js";

const handleAuthProxy: RequestHandler = async ({ getClientAddress, request, locals }) => {
	const convexSiteUrl = resolveConvexSiteUrlForAuthProxy({
		publicConvexUrl: env.PUBLIC_CONVEX_URL,
		publicConvexSiteUrl: env.PUBLIC_CONVEX_SITE_URL
	});
	return proxyAuthRequest(request, convexSiteUrl, {
		clientIp: getClientAddress(),
		requestId: locals.requestId
	});
};

export const GET = handleAuthProxy;
export const HEAD = handleAuthProxy;
export const OPTIONS = handleAuthProxy;
export const POST = handleAuthProxy;
