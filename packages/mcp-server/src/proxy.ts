import express, { type Request as ExpressRequest, type Response as ExpressResponse } from "express";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3100;
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;
export const HEALTH_ENDPOINT_PATH = "/health";
export const MCP_ENDPOINT_PATH = "/mcp";

const MCP_ALLOWED_METHODS = ["OPTIONS", "POST"] as const;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const CALLER_CONTROLLED_FORWARDING_HEADERS = new Set([
  "forwarded",
  "host",
  "via",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
  "x-request-id",
]);
const SAFE_RETRYABLE_JSON_RPC_METHODS = new Set([
  "initialize",
  "ping",
  "prompts/list",
  "resources/list",
  "tools/list",
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

type HeaderValue = string | string[] | number | undefined;

type Logger = Pick<typeof console, "error" | "info">;

export type McpProxyRuntimeConfig = {
  host: string;
  port: number;
  timeoutMs: number;
  upstreamMcpUrl: URL;
};

export type McpProxyRequest = {
  body?: Uint8Array;
  headers: Record<string, HeaderValue>;
  method: string;
  originalUrl: string;
};

export type McpProxyResponse = {
  body?: Uint8Array;
  headers: Headers;
  status: number;
};

export type McpProxyHandlerOptions = {
  fetchImpl?: typeof fetch;
  logger?: Logger;
  request: McpProxyRequest;
  timeoutMs?: number;
  upstreamMcpUrl: URL;
};

export function parsePort(portValue: string | undefined): number {
  const parsedPort = parseInt(portValue ?? `${DEFAULT_PORT}`, 10);
  return Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
}

export function parseTimeoutMs(timeoutValue: string | undefined): number {
  const parsedTimeout = parseInt(timeoutValue ?? `${DEFAULT_UPSTREAM_TIMEOUT_MS}`, 10);
  return Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_UPSTREAM_TIMEOUT_MS;
}

export function getUpstreamMcpUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const value = env.MCP_UPSTREAM_URL;
  if (!value) {
    throw new Error(
      "MCP_UPSTREAM_URL is required. Point it at the canonical hosted Celstate MCP endpoint, for example https://your-deployment.convex.site/mcp.",
    );
  }

  return new URL(value);
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): McpProxyRuntimeConfig {
  return {
    host: env.HOST ?? DEFAULT_HOST,
    port: parsePort(env.PORT),
    timeoutMs: parseTimeoutMs(env.MCP_UPSTREAM_TIMEOUT_MS),
    upstreamMcpUrl: getUpstreamMcpUrl(env),
  };
}

function headerEntries(headers: Record<string, HeaderValue>): [string, string][] {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    entries.push([key, Array.isArray(value) ? value.join(", ") : String(value)]);
  }
  return entries;
}

export function resolveRequestId(headers: Record<string, HeaderValue>): string {
  const value = headerEntries(headers).find(([key]) => key.toLowerCase() === "x-request-id")?.[1]?.trim();
  return value && REQUEST_ID_PATTERN.test(value) ? value : crypto.randomUUID();
}

export function buildUpstreamRequestUrl(originalUrl: string, upstreamMcpUrl: URL): URL {
  const incomingUrl = new URL(originalUrl, "http://celstate-mcp-proxy.local");
  const upstreamUrl = new URL(upstreamMcpUrl.toString());
  upstreamUrl.search = incomingUrl.search;
  return upstreamUrl;
}

export function buildUpstreamRequestHeaders(
  headers: Record<string, HeaderValue>,
  requestId: string,
): Headers {
  const upstreamHeaders = new Headers();
  for (const [key, value] of headerEntries(headers)) {
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || CALLER_CONTROLLED_FORWARDING_HEADERS.has(lowerKey)) {
      continue;
    }

    upstreamHeaders.set(key, value);
  }

  upstreamHeaders.set("x-request-id", requestId);
  return upstreamHeaders;
}

function isTransientUpstreamStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isRetryableMcpJsonRpcBody(body: Uint8Array | undefined): boolean {
  if (!body || body.length === 0) {
    return false;
  }

  try {
    const payload = JSON.parse(new TextDecoder().decode(body)) as { method?: unknown };
    return typeof payload.method === "string" && SAFE_RETRYABLE_JSON_RPC_METHODS.has(payload.method);
  } catch {
    return false;
  }
}

function jsonProxyResponse(status: number, payload: Record<string, unknown>, headers?: HeadersInit): McpProxyResponse {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json");
  return {
    body: new TextEncoder().encode(JSON.stringify(payload)),
    headers: responseHeaders,
    status,
  };
}

function methodNotAllowed(message: string, requestId: string): McpProxyResponse {
  return jsonProxyResponse(405, { error: message, requestId }, {
    allow: MCP_ALLOWED_METHODS.join(", "),
    "x-request-id": requestId,
  });
}

function shouldHandleLocally(request: McpProxyRequest, requestId: string): McpProxyResponse | null {
  const method = request.method.toUpperCase();
  const url = new URL(request.originalUrl, "http://celstate-mcp-proxy.local");
  if (url.pathname !== MCP_ENDPOINT_PATH) {
    return jsonProxyResponse(404, { error: "Not found", requestId }, { "x-request-id": requestId });
  }

  if (method === "OPTIONS") {
    return {
      headers: new Headers({
        allow: MCP_ALLOWED_METHODS.join(", "),
        "x-request-id": requestId,
      }),
      status: 204,
    };
  }

  if (method === "GET") {
    return methodNotAllowed(
      "This Celstate MCP proxy is stateless and does not expose a standalone SSE stream. Agent clients should POST JSON-RPC messages to /mcp.",
      requestId,
    );
  }

  if (method !== "POST") {
    return methodNotAllowed("Method not allowed. Send MCP requests with POST.", requestId);
  }

  return null;
}

async function fetchUpstreamWithRetry({
  body,
  fetchImpl,
  headers,
  logger,
  method,
  requestId,
  timeoutMs,
  upstreamUrl,
}: {
  body?: Uint8Array;
  fetchImpl: typeof fetch;
  headers: Headers;
  logger: Logger;
  method: string;
  requestId: string;
  timeoutMs: number;
  upstreamUrl: URL;
}): Promise<{ attempts: number; response: Response }> {
  const retryable = method.toUpperCase() === "POST" && isRetryableMcpJsonRpcBody(body);
  const maxAttempts = retryable ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const fetchBody = body ? new Blob([body.slice()]) : undefined;
      const response = await fetchImpl(upstreamUrl, {
        body: fetchBody,
        headers,
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (attempt < maxAttempts && isTransientUpstreamStatus(response.status)) {
        await response.arrayBuffer().catch(() => undefined);
        logger.info(JSON.stringify({
          attempt,
          event: "mcp_proxy_retrying_transient_status",
          requestId,
          status: response.status,
        }));
        continue;
      }

      return { attempts: attempt, response };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        logger.info(JSON.stringify({
          attempt,
          error: error instanceof Error ? error.message : String(error),
          event: "mcp_proxy_retrying_transient_error",
          requestId,
        }));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Upstream request failed"));
}

function buildProxyResponse(
  upstreamResponse: Response,
  requestId: string,
  body: Uint8Array,
): McpProxyResponse {
  const headers = new Headers();
  upstreamResponse.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) {
      return;
    }
    headers.set(key, value);
  });
  headers.set("x-request-id", requestId);

  return {
    body,
    headers,
    status: upstreamResponse.status,
  };
}

export async function handleMcpProxyRequest({
  fetchImpl = fetch,
  logger = console,
  request,
  timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
  upstreamMcpUrl,
}: McpProxyHandlerOptions): Promise<McpProxyResponse> {
  const startedAt = Date.now();
  const requestId = resolveRequestId(request.headers);
  const localResponse = shouldHandleLocally(request, requestId);
  if (localResponse) {
    return localResponse;
  }

  const upstreamUrl = buildUpstreamRequestUrl(request.originalUrl, upstreamMcpUrl);
  const headers = buildUpstreamRequestHeaders(request.headers, requestId);

  try {
    const { attempts, response } = await fetchUpstreamWithRetry({
      body: request.body,
      fetchImpl,
      headers,
      logger,
      method: request.method,
      requestId,
      timeoutMs,
      upstreamUrl,
    });
    const body = new Uint8Array(await response.arrayBuffer());

    logger.info(JSON.stringify({
      attempts,
      durationMs: Date.now() - startedAt,
      event: "mcp_proxy_request_completed",
      requestId,
      status: response.status,
      upstream: upstreamUrl.toString(),
    }));

    return buildProxyResponse(response, requestId, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy request failed";
    logger.error(JSON.stringify({
      durationMs: Date.now() - startedAt,
      error: message,
      event: "mcp_proxy_request_failed",
      requestId,
      upstream: upstreamUrl.toString(),
    }));

    return jsonProxyResponse(502, { error: message, requestId }, { "x-request-id": requestId });
  }
}

export async function readRequestBody(req: ExpressRequest): Promise<Uint8Array | undefined> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return undefined;
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : Uint8Array.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const merged = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function writeProxyResponse(
  res: ExpressResponse,
  proxyResponse: McpProxyResponse,
): Promise<void> {
  res.status(proxyResponse.status);
  proxyResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.send(proxyResponse.body ? Buffer.from(proxyResponse.body) : undefined);
}

export function createMcpProxyApp(config: McpProxyRuntimeConfig): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.get(HEALTH_ENDPOINT_PATH, (_req, res) => {
    res.json({
      mode: "proxy",
      status: "ok",
      upstream: config.upstreamMcpUrl.toString(),
    });
  });

  app.all(MCP_ENDPOINT_PATH, async (req, res) => {
    const proxyResponse = await handleMcpProxyRequest({
      request: {
        body: await readRequestBody(req),
        headers: req.headers,
        method: req.method,
        originalUrl: req.originalUrl,
      },
      timeoutMs: config.timeoutMs,
      upstreamMcpUrl: config.upstreamMcpUrl,
    });

    await writeProxyResponse(res, proxyResponse);
  });

  return app;
}
