import type { Handle } from "@sveltejs/kit";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { getConvexJwtToken } from "$lib/server/auth.js";
import {
	createCanonicalRedirectResponse,
	getCanonicalRedirectUrl
} from "$lib/server/canonical-site.js";
import { withResponseHeader } from "$lib/server/response.js";

const AUTH_LOG_SCOPE = "auth";

const toConsoleMethod = (level: "info" | "warn" | "error") => {
	switch (level) {
		case "error":
			return console.error;
		case "warn":
			return console.warn;
		default:
			return console.info;
	}
};

const getRedirectSummary = (location: string | null, baseUrl: URL) => {
	if (!location) {
		return undefined;
	}

	try {
		const target = new URL(location, baseUrl);
		return {
			host: target.host,
			pathname: target.pathname,
			error: target.searchParams.get("error") ?? undefined
		};
	} catch {
		return {
			value: location
		};
	}
};

const isAuthObservedRequest = (url: URL) =>
	url.pathname.startsWith("/api/auth") || url.pathname === "/auth" || url.searchParams.has("error");

const logAuthRequestEvent = (
	level: "info" | "warn" | "error",
	event: string,
	data: Record<string, unknown>
) => {
	toConsoleMethod(level)(
		JSON.stringify({
			scope: AUTH_LOG_SCOPE,
			event,
			timestamp: new Date().toISOString(),
			...data
		})
	);
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestId = crypto.randomUUID();
	const canonicalRedirectUrl = getCanonicalRedirectUrl({
		requestUrl: event.url,
		publicSiteUrl: PUBLIC_SITE_URL
	});

	if (canonicalRedirectUrl) {
		return createCanonicalRedirectResponse(canonicalRedirectUrl, event.locals.requestId);
	}

	event.locals.token = getConvexJwtToken(event.cookies);
	const observedRequest = isAuthObservedRequest(event.url);

	if (observedRequest) {
		logAuthRequestEvent("info", "request_started", {
			requestId: event.locals.requestId,
			method: event.request.method,
			host: event.url.host,
			pathname: event.url.pathname,
			origin: event.request.headers.get("origin") ?? undefined,
			referer: event.request.headers.get("referer") ?? undefined,
			error: event.url.searchParams.get("error") ?? undefined,
			hasAuthToken: event.locals.token !== undefined
		});
	}

	try {
		const response = withResponseHeader(await resolve(event), "x-request-id", event.locals.requestId);

		if (observedRequest) {
			logAuthRequestEvent(response.status >= 400 ? "warn" : "info", "request_finished", {
				requestId: event.locals.requestId,
				method: event.request.method,
				host: event.url.host,
				pathname: event.url.pathname,
				status: response.status,
				redirect: getRedirectSummary(response.headers.get("location"), event.url)
			});
		}

		return response;
	} catch (error) {
		logAuthRequestEvent("error", "request_failed", {
			requestId: event.locals.requestId,
			method: event.request.method,
			host: event.url.host,
			pathname: event.url.pathname,
			error:
				error instanceof Error
					? {
							name: error.name,
							message: error.message
						}
					: {
							value: String(error)
						}
		});
		throw error;
	}
};
