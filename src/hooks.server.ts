import { sequence } from "@sveltejs/kit/hooks";
import * as Sentry from "@sentry/sveltekit";
import type { Handle } from "@sveltejs/kit";
import { withClerkHandler } from "svelte-clerk/server";
import { building, dev } from "$app/environment";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { recordRepeatedAuthEndpoint5xx } from "$lib/server/auth-alerts.js";
import {
	createCanonicalRedirectResponse,
	getCanonicalRedirectUrl,
} from "$lib/server/canonical-site.js";
import { withResponseHeader } from "$lib/server/response.js";

const clerkSecretKey = env.CLERK_SECRET_KEY?.trim() ?? "";
const clerkPublishableKey = publicEnv.PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";

if (!building && !dev && (!clerkSecretKey || !clerkPublishableKey)) {
	throw new Error(
		"Clerk env missing: set CLERK_SECRET_KEY and PUBLIC_CLERK_PUBLISHABLE_KEY on the server runtime.",
	);
}

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

	const auth = event.locals.auth();
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
			authUserPresent: auth.userId != null,
			sessionPresent: auth.sessionId != null,
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

export const handle: Handle = sequence(
	withClerkHandler(),
	Sentry.sentryHandle(),
	celstateHandle,
);
export const handleError = Sentry.handleErrorWithSentry();
