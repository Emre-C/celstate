/**
 * Convex uses the same deployment name for the realtime API (`*.convex.cloud`) and
 * HTTP / site actions (`*.convex.site`). Deriving the site URL from `PUBLIC_CONVEX_URL`
 * avoids maintaining a second env var that can drift out of sync.
 *
 * When `PUBLIC_CONVEX_URL` points at a local Convex process (`http://127.0.0.1:…`),
 * there is no `.convex.cloud` host to derive from — callers must set `PUBLIC_CONVEX_SITE_URL`
 * to the cloud HTTPS site URL for the same logical deployment (see docs/product/authentication.md).
 */

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const parseOriginOnlyUrl = (value: string): URL | null => {
	let url: URL;

	try {
		url = new URL(value.trim());
	} catch {
		return null;
	}

	if (url.username || url.password || url.search || url.hash) {
		return null;
	}

	if (url.pathname !== "/") {
		return null;
	}

	return url;
};

const normalizeConvexCloudOrigin = (value: string): string | null => {
	const url = parseOriginOnlyUrl(value);

	if (!url || url.protocol !== "https:" || url.port || !url.hostname.endsWith(".convex.cloud")) {
		return null;
	}

	return url.origin;
};

const normalizeConvexSiteOrigin = (value: string): string | null => {
	const url = parseOriginOnlyUrl(value);

	if (!url || url.protocol !== "https:" || url.port || !url.hostname.endsWith(".convex.site")) {
		return null;
	}

	return url.origin;
};

const isSupportedLocalRealtimeOrigin = (value: string): boolean => {
	const url = parseOriginOnlyUrl(value);

	if (!url) {
		return false;
	}

	return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTNAMES.has(url.hostname);
};

export const deriveConvexSiteUrlFromPublicConvexUrl = (convexUrl: string): string | null => {
	const normalizedCloudOrigin = normalizeConvexCloudOrigin(convexUrl);

	if (!normalizedCloudOrigin) {
		return null;
	}

	const u = new URL(normalizedCloudOrigin);

	const siteHost = u.hostname.replace(/\.convex\.cloud$/u, ".convex.site");
	return `https://${siteHost}`;
};

export const resolveConvexSiteUrlForAuthProxy = (options: {
	publicConvexUrl: string | undefined;
	publicConvexSiteUrl: string | undefined;
}): string => {
	const cloud = options.publicConvexUrl?.trim();
	const explicitSite = options.publicConvexSiteUrl?.trim();
	const normalizedExplicitSite = explicitSite ? normalizeConvexSiteOrigin(explicitSite) : null;

	if (explicitSite && !normalizedExplicitSite) {
		throw new Error(
			`PUBLIC_CONVEX_SITE_URL must be an origin-only https URL on *.convex.site when set.`
		);
	}

	const derived = cloud ? deriveConvexSiteUrlFromPublicConvexUrl(cloud) : null;

	if (derived) {
		if (normalizedExplicitSite && normalizedExplicitSite !== derived) {
			throw new Error(
				`PUBLIC_CONVEX_SITE_URL must match the deployment implied by PUBLIC_CONVEX_URL. ` +
					`Expected ${derived} (or remove PUBLIC_CONVEX_SITE_URL). Got ${explicitSite}.`
			);
		}
		return derived;
	}

	if (cloud && !isSupportedLocalRealtimeOrigin(cloud)) {
		throw new Error(
			`PUBLIC_CONVEX_URL must be either an origin-only https URL on *.convex.cloud or a loopback origin for local development. Got ${cloud}.`
		);
	}

	if (normalizedExplicitSite) {
		return normalizedExplicitSite;
	}

	throw new Error(
		`Could not determine Convex site URL for the auth proxy. ` +
			`Set PUBLIC_CONVEX_URL to https://<deployment>.convex.cloud, ` +
			`or set PUBLIC_CONVEX_SITE_URL to https://<deployment>.convex.site (required when using a local Convex URL for realtime).`
	);
};
