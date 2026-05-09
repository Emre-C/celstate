import { AUTH_PROXY_CLIENT_IP_HEADER } from "../auth/config.js";
import { reportAuthProxyFailure } from "./auth-alerts.js";

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
const AUTH_UPSTREAM_TIMEOUT_MS = 2_500;
const AUTH_UPSTREAM_DIAGNOSTIC_HEADERS = [
	"cf-ray",
	"cf-cache-status",
	"convex-usher",
	"server",
	"via",
	"x-vercel-id"
] as const;

type AuthProxyRequestOptions = {
	clientIp?: string;
	requestId?: string;
	upstreamTimeoutMs?: number;
};

type AuthProxyFailureDetails = {
	attempts: number;
	error?: string;
	upstreamHeaders?: Record<string, string>;
	upstreamStatus?: number;
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
	if (error.name === "TimeoutError") {
		return true;
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

const collectDiagnosticHeaders = (headers: Headers): Record<string, string> | undefined => {
	const diagnosticHeaders = Object.fromEntries(
		AUTH_UPSTREAM_DIAGNOSTIC_HEADERS.flatMap((headerName) => {
			const value = headers.get(headerName);
			return value ? [[headerName, value]] : [];
		})
	);

	return Object.keys(diagnosticHeaders).length > 0 ? diagnosticHeaders : undefined;
};

const upstreamUnavailableResponse = (details: AuthProxyFailureDetails) =>
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
				"retry-after": "30",
				"x-auth-upstream-attempts": String(details.attempts),
				...(details.upstreamStatus !== undefined
					? { "x-auth-upstream-status": String(details.upstreamStatus) }
					: {})
			}
		}
	);

const removeHeaders = (headers: Headers, names: Set<string>) => {
	for (const headerName of names) {
		headers.delete(headerName);
	}
};

const reconcileProxyResponseHeaders = (response: Response) => {
	if (!response.headers.has("content-encoding")) {
		return response;
	}

	const headers = new Headers(response.headers);
	headers.delete("content-encoding");
	headers.delete("content-length");

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
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

const createUpstreamAttemptSignal = (clientSignal: AbortSignal, timeoutMs: number) => {
	const controller = new AbortController();
	let timedOut = false;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	const abortFromClient = () => {
		controller.abort(clientSignal.reason ?? new DOMException("aborted", "AbortError"));
	};

	if (clientSignal.aborted) {
		abortFromClient();
	} else {
		clientSignal.addEventListener("abort", abortFromClient, { once: true });
		timeoutId = setTimeout(() => {
			timedOut = true;
			controller.abort(
				new DOMException(`Auth upstream timed out after ${timeoutMs}ms`, "TimeoutError")
			);
		}, timeoutMs);
	}

	return {
		signal: controller.signal,
		getTimedOut: () => timedOut,
		cleanup: () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			clientSignal.removeEventListener("abort", abortFromClient);
		}
	};
};

const reportAuthProxyBoundaryFailure = (
	request: Request,
	sourceUrl: URL,
	options: AuthProxyRequestOptions,
	details: AuthProxyFailureDetails
) => {
	void reportAuthProxyFailure({
		attempts: details.attempts,
		error: details.error,
		host: sourceUrl.host,
		method: request.method,
		origin: request.headers.get("origin") ?? undefined,
		pathname: sourceUrl.pathname,
		referer: request.headers.get("referer") ?? undefined,
		requestId: options.requestId,
		upstreamHeaders: details.upstreamHeaders,
		upstreamStatus: details.upstreamStatus
	});
};

/**
 * Proxies Better Auth to Convex. Forwards `signal` so client disconnect aborts the outbound fetch.
 * Retries upstream failures only for GET/HEAD/OPTIONS (safe, no body replay issues).
 * Normalizes upstream fetch failures and upstream 5xx responses to our 503 JSON contract.
 */
export const proxyAuthRequest = async (
	request: Request,
	convexSiteUrl: string,
	options: AuthProxyRequestOptions = {}
): Promise<Response> => {
	const method = request.method.toUpperCase();
	const maxAttempts = RETRYABLE_METHODS.has(method) ? MAX_ATTEMPTS_SAFE_METHOD : 1;
	const upstreamTimeoutMs = options.upstreamTimeoutMs ?? AUTH_UPSTREAM_TIMEOUT_MS;
	const sourceUrl = new URL(request.url);
	let lastError: unknown;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const proxied = buildAuthProxyRequest(request, convexSiteUrl, options);
		const attemptSignal = createUpstreamAttemptSignal(request.signal, upstreamTimeoutMs);
		try {
			const upstreamResponse = reconcileProxyResponseHeaders(await fetch(proxied, {
				method: request.method,
				redirect: "manual",
				signal: attemptSignal.signal
			}));

			if (upstreamResponse.status >= 500) {
				if (attempt < maxAttempts - 1) {
					await sleep(RETRY_BACKOFF_MS[attempt] ?? 600, request.signal);
					continue;
				}

				const details = {
					attempts: attempt + 1,
					error: `Upstream auth service returned ${upstreamResponse.status}`,
					upstreamHeaders: collectDiagnosticHeaders(upstreamResponse.headers),
					upstreamStatus: upstreamResponse.status
				};
				reportAuthProxyBoundaryFailure(request, sourceUrl, options, details);
				return upstreamUnavailableResponse(details);
			}

			return upstreamResponse;
		} catch (error) {
			if (request.signal.aborted) {
				throw error;
			}
			const effectiveError =
				attemptSignal.getTimedOut() && error instanceof Error
					? new DOMException(error.message, "TimeoutError")
					: error;
			lastError = effectiveError;
			if (!isRetryableUpstreamFetchError(effectiveError)) {
				throw error;
			}
			if (attempt < maxAttempts - 1) {
				await sleep(RETRY_BACKOFF_MS[attempt] ?? 600, request.signal);
			}
		} finally {
			attemptSignal.cleanup();
		}
	}

	const details = {
		attempts: maxAttempts,
		error: lastError instanceof Error ? lastError.message : lastError ? String(lastError) : undefined,
	};
	reportAuthProxyBoundaryFailure(request, sourceUrl, options, details);
	return upstreamUnavailableResponse(details);
};
