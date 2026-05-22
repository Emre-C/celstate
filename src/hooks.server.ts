import { sequence } from "@sveltejs/kit/hooks";
import * as Sentry from "@sentry/sveltekit";
import type { Handle } from "@sveltejs/kit";
import { authKitHandle, configureAuthKit } from "@workos/authkit-sveltekit";
import { building, dev } from "$app/environment";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { env } from "$env/dynamic/private";
import { recordRepeatedAuthEndpoint5xx } from "$lib/server/auth-alerts.js";
import {
	createCanonicalRedirectResponse,
	getCanonicalRedirectUrl,
} from "$lib/server/canonical-site.js";
import { withResponseHeader } from "$lib/server/response.js";
import { AUTHKIT_SESSION_COOKIE } from "$lib/server/authkit-constants.js";

const kitClientId = env.WORKOS_CLIENT_ID?.trim() ?? "";
const kitApiKey = env.WORKOS_API_KEY?.trim() ?? "";
const kitRedirectUri = env.WORKOS_REDIRECT_URI?.trim() ?? "";
const kitCookiePassword = env.WORKOS_COOKIE_PASSWORD?.trim() ?? "";

if (!building && !dev && (!kitClientId || !kitApiKey || !kitRedirectUri || !kitCookiePassword)) {
	throw new Error(
		"WorkOS AuthKit env missing: set WORKOS_CLIENT_ID, WORKOS_API_KEY, WORKOS_REDIRECT_URI, WORKOS_COOKIE_PASSWORD on the server runtime.",
	);
}

configureAuthKit({
	clientId: kitClientId,
	apiKey: kitApiKey,
	redirectUri: kitRedirectUri,
	cookiePassword: kitCookiePassword,
});

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
			error: target.searchParams.get("error") ?? undefined,
		};
	} catch {
		return {
			value: location,
		};
	}
};

const isAuthObservedRequest = (url: URL) =>
	url.pathname.startsWith("/api/auth") ||
	url.pathname === "/auth" ||
	url.pathname === "/api/auth/initiate" ||
	url.pathname === "/callback" ||
	url.pathname === "/sign-out" ||
	url.searchParams.has("error");

const isAuthAlertableRequest = (url: URL) =>
	url.pathname.startsWith("/api/auth") ||
	url.pathname === "/auth" ||
	url.pathname === "/api/auth/initiate" ||
	url.pathname === "/callback";

const logAuthRequestEvent = (
	level: "info" | "warn" | "error",
	event: string,
	data: Record<string, unknown>,
) => {
	toConsoleMethod(level)(
		JSON.stringify({
			scope: AUTH_LOG_SCOPE,
			event,
			timestamp: new Date().toISOString(),
			...data,
		}),
	);
};

const celstateHandle: Handle = async ({ event, resolve }) => {
	event.locals.requestId = crypto.randomUUID();
	const canonicalRedirectUrl =
		!dev &&
		getCanonicalRedirectUrl({
			requestUrl: event.url,
			publicSiteUrl: PUBLIC_SITE_URL,
		});

	if (canonicalRedirectUrl) {
		return createCanonicalRedirectResponse(canonicalRedirectUrl, event.locals.requestId);
	}

	event.locals.token = event.locals.auth?.accessToken;
	const observedRequest = isAuthObservedRequest(event.url);
	const alertableRequest = isAuthAlertableRequest(event.url);

	if (observedRequest) {
		logAuthRequestEvent("info", "request_started", {
			requestId: event.locals.requestId,
			method: event.request.method,
			host: event.url.host,
			pathname: event.url.pathname,
			origin: event.request.headers.get("origin") ?? undefined,
			referer: event.request.headers.get("referer") ?? undefined,
			error: event.url.searchParams.get("error") ?? undefined,
			hasAccessToken: event.locals.token !== undefined,
			authUserPresent: event.locals.auth?.user != null,
		});
	}

	try {
		const response = withResponseHeader(
			await resolve(event),
			"x-request-id",
			event.locals.requestId,
		);

		if (alertableRequest && response.status >= 500) {
			void recordRepeatedAuthEndpoint5xx({
				host: event.url.host,
				method: event.request.method,
				origin: event.request.headers.get("origin") ?? undefined,
				pathname: event.url.pathname,
				referer: event.request.headers.get("referer") ?? undefined,
				requestId: event.locals.requestId,
				status: response.status,
			});
		}

		if (observedRequest) {
			logAuthRequestEvent(response.status >= 400 ? "warn" : "info", "request_finished", {
				requestId: event.locals.requestId,
				method: event.request.method,
				host: event.url.host,
				pathname: event.url.pathname,
				status: response.status,
				redirect: getRedirectSummary(response.headers.get("location"), event.url),
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
							message: error.message,
						}
					: {
							value: String(error),
						},
		});
		throw error;
	}
};

/**
 * WorkOS AuthKit's `authKitHandle` validates the session at request start and,
 * if near expiry, refreshes it (`refreshedSessionData`). After the route handler
 * resolves (e.g. `/sign-out` clearing the cookie), `authKitHandle` appends the
 * refreshed session cookie to the response — overwriting the clear-cookie.
 *
 * This outermost hook runs *after* `authKitHandle` on the response path and
 * strips any re-set `wos-session` cookies when the route already emitted a
 * clear-cookie for the same name.
 */
const signOutPostProcessHandle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	if (event.url.pathname !== "/sign-out" || response.status !== 302) {
		return response;
	}

	const cookies = response.headers.getSetCookie?.() ?? [];
	const sessionCookies = cookies.filter((c) => c.startsWith(`${AUTHKIT_SESSION_COOKIE}=`));
	const clearCookies = sessionCookies.filter(
		(c) => c.includes("Max-Age=0") || c.includes("Expires=Thu, 01 Jan 1970"),
	);

	// No conflict — pass through
	if (clearCookies.length === 0 || sessionCookies.length === clearCookies.length) {
		return response;
	}

	// Keep only non-session cookies + session clear-cookies (drop re-sets)
	const cleaned = cookies.filter(
		(c) =>
			!c.startsWith(`${AUTHKIT_SESSION_COOKIE}=`) ||
			c.includes("Max-Age=0") ||
			c.includes("Expires=Thu, 01 Jan 1970"),
	);

	const headers = new Headers();
	for (const [key, value] of response.headers) {
		if (key.toLowerCase() !== "set-cookie") {
			headers.set(key, value);
		}
	}
	for (const c of cleaned) {
		headers.append("Set-Cookie", c);
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
};

export const handle: Handle = sequence(
	signOutPostProcessHandle,
	authKitHandle(),
	Sentry.sentryHandle(),
	celstateHandle,
);
export const handleError = Sentry.handleErrorWithSentry();
