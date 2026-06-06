/** Safe in-app return path after sign-in (rejects protocol-relative and off-site targets). */
export const normalizeAuthReturnTo = (raw: string | null | undefined, fallback = "/app") => {
	const trimmed = raw?.trim();
	if (trimmed && trimmed.startsWith("/") && !trimmed.startsWith("//")) {
		return trimmed;
	}
	return fallback;
};

export const buildProtectedReturnPath = (pathname: string, search: string) =>
	`${pathname}${search}`;

/**
 * Starts authentication immediately.
 * Used when an unauthenticated user hits a protected route or the marketing CTA.
 */
export const buildAuthInitiateTarget = (pathname: string, search: string) => {
	const returnTo = buildProtectedReturnPath(pathname, search);
	return buildAuthInitiateTargetFromReturnTo(returnTo);
};

export const buildAuthInitiateTargetFromReturnTo = (returnTo: string) =>
	`/api/auth/initiate?returnTo=${encodeURIComponent(normalizeAuthReturnTo(returnTo))}`;

/**
 * Celstate sign-in recovery page — show errors and a retry affordance only.
 */
export const buildAuthPageTarget = (
	returnTo: string,
	options?: { error?: string },
) => {
	const params = new URLSearchParams({
		redirectTo: normalizeAuthReturnTo(returnTo),
	});
	if (options?.error) {
		params.set("error", options.error);
	}
	return `/auth?${params.toString()}`;
};
