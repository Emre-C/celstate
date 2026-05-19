import { handleErrorWithSentry, init as sentryInit } from "@sentry/sveltekit";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { resolveSentryEnvironmentFromSignals } from "$lib/sentry-environment";

/**
 * SvelteKit client lifecycle hook — runs once when the app starts in the browser.
 * Sentry SDK init must run here (not only at module top-level) so instrumentation order is correct.
 */
export function init() {
	const dsn = import.meta.env.PUBLIC_SENTRY_DSN?.trim?.();
	if (!dsn) {
		return;
	}

	sentryInit({
		dsn,
		environment: resolveSentryEnvironmentFromSignals({
			siteUrl: PUBLIC_SITE_URL,
			vercelEnv: import.meta.env.VERCEL_ENV,
			nodeEnv: import.meta.env.PROD ? "production" : "development",
			dev: import.meta.env.DEV,
		}),
		tracesSampleRate: 0.1,
		enableLogs: true,
		sendDefaultPii: true,
	});
}

export const handleError = handleErrorWithSentry();
