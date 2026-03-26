import * as Sentry from "@sentry/sveltekit";
import { AUTH_PROXY_CLIENT_IP_HEADER } from "../auth/config.js";

const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CLIENT_CONTROLLED_PROXY_HEADERS = new Set([
	"forwarded",
	"host",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-port",
	"x-forwarded-proto",
	"x-real-ip",
	"x-request-id",
	AUTH_PROXY_CLIENT_IP_HEADER
]);
const HOP_BY_HOP_REQUEST_HEADERS = new Set([
	"accept-encoding",
	"connection",
	"content-length",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade"
]);
/** GET /token etc.: transient connect blips — bounded retries without duplicating POST bodies. */
const MAX_ATTEMPTS_SAFE_METHOD = 3;
const RETRY_BACKOFF_MS = [250, 600] as const;

type AuthProxyRequestOptions = {
	clientIp?: string;
	requestId?: string;
};

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		const onAbort = () => {
			clearTimeout(timeoutId);
			signal?.removeEventListener("abort", onAbort);
			reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
		};

		if (signal?.aborted) {
			onAbort();
			return;
		}

		timeoutId = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		signal?.addEventListener("abort", onAbort, { once: true });
	});

/** Exported for unit tests — Node undici wraps ConnectTimeoutError in TypeError.cause. */
export const isRetryableUpstreamFetchError = (error: unknown): boolean => {
	if (error instanceof Error && error.name === "AbortError") {
		return false;
	}
	if (!(error instanceof Error)) {
		return false;
	}
	if (error.message === "fetch failed") {
		return true;
	}
	const c = error.cause;
	if (c instanceof Error) {
		if (c.name === "ConnectTimeoutError") {
			return true;
		}
		if ("code" in c && (c as { code?: string }).code === "UND_ERR_CONNECT_TIMEOUT") {
			return true;
		}
	}
	return false;
};

const upstreamUnavailableResponse = () =>
	new Response(
		JSON.stringify({
			error: "auth_backend_unavailable",
			message: "Authentication service is temporarily unavailable."
		}),
		{
			status: 503,
			statusText: "Service Unavailable",
			headers: {
				"content-type": "application/json",
				"retry-after": "30"
			}
		}
	);

const logConvexUnreachable = (pathname: string, attempts: number) => {
	if (import.meta.env.DEV) {
		return;
	}
	Sentry.captureMessage("Auth proxy: upstream Convex unreachable", {
		level: "warning",
		fingerprint: ["auth-proxy", "convex-unreachable"],
		tags: { auth_proxy: "true" },
		extra: { pathname, attempts }
	});
};

const removeHeaders = (headers: Headers, names: Set<string>) => {
	for (const headerName of names) {
		headers.delete(headerName);
	}
};

export const buildAuthProxyRequest = (
	request: Request,
	convexSiteUrl: string,
	options: AuthProxyRequestOptions = {}
) => {
	const sourceUrl = new URL(request.url);
	const targetUrl = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, convexSiteUrl);
	const proxiedRequest = new Request(targetUrl, request);

	removeHeaders(proxiedRequest.headers, HOP_BY_HOP_REQUEST_HEADERS);
	removeHeaders(proxiedRequest.headers, CLIENT_CONTROLLED_PROXY_HEADERS);
	proxiedRequest.headers.set("host", targetUrl.host);
	proxiedRequest.headers.set("x-forwarded-host", sourceUrl.host);
	proxiedRequest.headers.set("x-forwarded-proto", sourceUrl.protocol.slice(0, -1));
	proxiedRequest.headers.set("x-forwarded-port", getForwardedPort(sourceUrl));

	if (options.clientIp) {
		proxiedRequest.headers.set("x-forwarded-for", options.clientIp);
		proxiedRequest.headers.set(AUTH_PROXY_CLIENT_IP_HEADER, options.clientIp);
	}

	if (options.requestId) {
		proxiedRequest.headers.set("x-request-id", options.requestId);
	}

	return proxiedRequest;
};

const getForwardedPort = (url: URL) => {
	if (url.port) {
		return url.port;
	}

	return url.protocol === "https:" ? "443" : "80";
};

/**
 * Proxies Better Auth to Convex. Forwards `signal` so client disconnect aborts the outbound fetch.
 * Retries connect-level failures only for GET/HEAD/OPTIONS (safe, no body replay issues).
 * On persistent failure returns 503 JSON instead of throwing, so the route completes and Sentry does not treat it as an unhandled error.
 */
export const proxyAuthRequest = async (
	request: Request,
	convexSiteUrl: string,
	options: AuthProxyRequestOptions = {}
): Promise<Response> => {
	const method = request.method.toUpperCase();
	const maxAttempts = RETRYABLE_METHODS.has(method) ? MAX_ATTEMPTS_SAFE_METHOD : 1;
	const pathname = new URL(request.url).pathname;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const proxied = buildAuthProxyRequest(request, convexSiteUrl, options);
		try {
			return await fetch(proxied, {
				method: request.method,
				redirect: "manual",
				signal: request.signal
			});
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw error;
			}
			if (!isRetryableUpstreamFetchError(error)) {
				throw error;
			}
			if (attempt < maxAttempts - 1) {
				await sleep(RETRY_BACKOFF_MS[attempt] ?? 600, request.signal);
			}
		}
	}

	logConvexUnreachable(pathname, maxAttempts);
	return upstreamUnavailableResponse();
};
