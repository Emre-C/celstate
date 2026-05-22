import { redirect } from "@sveltejs/kit";
import { buildAuthPageTarget, normalizeAuthReturnTo } from "$lib/auth/redirect.js";
import type { PageServerLoad } from "./$types";
import * as Sentry from "@sentry/sveltekit";

/**
 * WorkOS AuthKit SDK redirects callback failures to /auth/error?code=UPPERCASE_CODE.
 * This route maps those SDK codes to our product-facing lowercase error keys and
 * redirects to /auth?error=... so the user sees a coherent recovery page.
 *
 * SDK codes observed from @workos/authkit-sveltekit:
 *   STATE_MISMATCH      — CSRF/state validation failed (often origin/callback mismatch)
 *   PKCE_COOKIE_MISSING — PKCE verifier cookie was not present at callback time
 *   ACCESS_DENIED       — User cancelled or denied the OAuth prompt
 *   AUTH_FAILED         — Generic authentication failure during callback handling
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
		Sentry.captureMessage("AuthKit callback failure", {
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
