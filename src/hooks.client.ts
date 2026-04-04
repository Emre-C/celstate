import { handleErrorWithSentry, init as sentryInit } from "@sentry/sveltekit";

/**
 * SvelteKit client lifecycle hook — runs once when the app starts in the browser.
 * Sentry SDK init must run here (not only at module top-level) so instrumentation order is correct.
 */
export function init() {
        sentryInit({
                dsn: "https://02ede8116352a88253602c00d8a4f134@o4510330822197248.ingest.us.sentry.io/4511077711347712",

                tracesSampleRate: 0.1,

                enableLogs: true,

                sendDefaultPii: true
        });
}

export const handleError = handleErrorWithSentry();
