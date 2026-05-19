import * as Sentry from "@sentry/sveltekit";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { resolveSentryEnvironmentFromSignals } from "$lib/sentry-environment";

const dsn = process.env.SENTRY_DSN?.trim();
if (dsn) {
	const dev = process.env.NODE_ENV !== "production";
	Sentry.init({
		dsn,
		environment: resolveSentryEnvironmentFromSignals({
			siteUrl: PUBLIC_SITE_URL,
			vercelEnv: process.env.VERCEL_ENV,
			nodeEnv: process.env.NODE_ENV,
			dev,
		}),
		tracesSampleRate: 1.0,
		enableLogs: true,
	});
}
