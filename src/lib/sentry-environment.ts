/**
 * Shared rules for Sentry `environment` so localhost/local URLs never report as `production`.
 */
export function resolveSentryEnvironmentFromSignals(input: {
	readonly siteUrl: string | undefined;
	readonly vercelEnv: string | undefined;
	readonly nodeEnv: string | undefined;
	readonly dev: boolean;
}): string {
	const site = input.siteUrl?.trim() ?? "";
	if (/localhost|127\.0\.0\.1/i.test(site)) {
		return "development";
	}
	const ve = input.vercelEnv?.trim();
	if (ve === "production") {
		return "production";
	}
	if (ve === "preview") {
		return "preview";
	}
	if (input.dev) {
		return "development";
	}
	return input.nodeEnv === "production" ? "production" : "development";
}
