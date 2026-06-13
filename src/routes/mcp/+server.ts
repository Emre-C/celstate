import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { env as publicEnv } from "$env/dynamic/public";
import {
	buildConvexMcpUpstreamUrl,
	handleMcpProxyRequest,
	readRequestBody,
	toWebResponse,
} from "$lib/server/mcp-proxy.js";
import type { RequestHandler } from "./$types";

const handleMcpRoute: RequestHandler = async ({ fetch, request, url }) => {
	const proxyResponse = await handleMcpProxyRequest({
		fetchImpl: fetch,
		request: {
			body: await readRequestBody(request),
			headers: request.headers,
			method: request.method,
			originalUrl: `${url.pathname}${url.search}`,
		},
		upstreamMcpUrl: buildConvexMcpUpstreamUrl({
			publicConvexSiteUrl: publicEnv.PUBLIC_CONVEX_SITE_URL,
			publicConvexUrl: PUBLIC_CONVEX_URL,
		}),
	});

	return toWebResponse(proxyResponse);
};

export const GET = handleMcpRoute;
export const OPTIONS = handleMcpRoute;
export const POST = handleMcpRoute;
export const fallback = handleMcpRoute;
