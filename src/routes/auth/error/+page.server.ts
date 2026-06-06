import { redirect } from "@sveltejs/kit";
import { buildAuthPageTarget, normalizeAuthReturnTo } from "$lib/auth/redirect.js";
import type { PageServerLoad } from "./$types";
import * as Sentry from "@sentry/sveltekit";

/**
 * Generic auth error recovery page.
 * Maps upstream error codes to product-facing lowercase error keys and
 * redirects to /auth?error=... so the user sees a coherent recovery page.
 */

const SDK_CODE_TO_PRODUCT_CODE: Record<string, string> = {
	STATE_MISMATCH: "state_mismatch",
	PKCE_COOKIE_MISSING: "state_mismatch",
	ACCESS_DENIED: "access_denied",
	AUTH_FAILED: "default",
};

const SDK_CODE_TO_SEVERITY: Record<string, "warning" | "error"> = {
	STATE_MISMATCH: "warning",
	PKCE_COOKIE_MISSING: "warning",
	ACCESS_DENIED: "warning",
	AUTH_FAILED: "error",
};

export const load: PageServerLoad = async ({ url, request }) => {
	const rawCode = url.searchParams.get("code")?.trim() ?? "";
	const productCode = SDK_CODE_TO_PRODUCT_CODE[rawCode] ?? "default";
	const severity = SDK_CODE_TO_SEVERITY[rawCode] ?? "warning";

	const returnTo = normalizeAuthReturnTo(url.searchParams.get("returnTo"));
	const redirectTarget = buildAuthPageTarget(returnTo, { error: productCode });

	// Structured observability for auth callback failures
	const logPayload = {
		scope: "auth",
		event: "callback_failure_redirect",
		timestamp: new Date().toISOString(),
		sdkCode: rawCode || "UNKNOWN",
		productCode,
		severity,
		host: url.host,
		referer: request.headers.get("referer") ?? undefined,
	};

	if (severity === "error") {
		console.error(JSON.stringify(logPayload));
		Sentry.captureMessage("Auth callback failure", {
			level: "warning",
			tags: {
				auth_callback: "true",
				callback_error_code: rawCode,
			},
			extra: {
				sdkCode: rawCode,
				productCode,
				host: url.host,
				referer: request.headers.get("referer") ?? undefined,
			},
		});
	} else {
		console.warn(JSON.stringify(logPayload));
	}

	redirect(302, redirectTarget);
};
