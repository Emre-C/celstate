import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ActionCtx } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.js";
import { internal } from "../_generated/api.js";
import { sha256Hex } from "./keys.js";
import {
  MCP_ALLOWED_METHODS,
  MCP_CORS_ALLOWED_HEADERS,
  MCP_CORS_EXPOSED_HEADERS,
  MCP_SERVER_INFO,
} from "./constants.js";
import { registerCreditsTools } from "./tools/credits.js";
import { registerGenerateTools } from "./tools/generate.js";
import { registerGetImageTools } from "./tools/getImage.js";
import { registerListImageTools } from "./tools/listImages.js";

export interface McpToolContext {
  runQuery: ActionCtx["runQuery"];
  runMutation: ActionCtx["runMutation"];
  user: {
    _id: Id<"users">;
    credits?: number;
    email?: string;
  };
  requestId: string;
}

function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) {
    return null;
  }
  const token = match[1]?.trim();
  return token || null;
}

function getAllowedOrigins(): string[] {
  const configuredOrigins = process.env.MCP_ALLOWED_ORIGINS;
  if (!configuredOrigins) {
    return [];
  }

  return configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(request: Request, originHeader: string): boolean {
  try {
    const requestOrigin = new URL(request.url).origin;
    if (originHeader === requestOrigin) {
      return true;
    }

    return getAllowedOrigins().includes(originHeader);
  } catch {
    return false;
  }
}

function buildCorsHeaders(request: Request): Headers {
  const headers = new Headers();
  const originHeader = request.headers.get("origin");

  if (!originHeader || !isAllowedOrigin(request, originHeader)) {
    return headers;
  }

  headers.set("Access-Control-Allow-Origin", originHeader);
  headers.set("Access-Control-Allow-Headers", MCP_CORS_ALLOWED_HEADERS.join(", "));
  headers.set("Access-Control-Allow-Methods", MCP_ALLOWED_METHODS.join(", "));
  headers.set("Access-Control-Expose-Headers", MCP_CORS_EXPOSED_HEADERS.join(", "));
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");

  return headers;
}

function buildResponseHeaders(
  request: Request,
  requestId: string,
  extraHeaders?: HeadersInit,
): Headers {
  const headers = buildCorsHeaders(request);
  headers.set("cache-control", "no-store");
  headers.set("x-request-id", requestId);

  if (extraHeaders) {
    for (const [key, value] of new Headers(extraHeaders).entries()) {
      headers.set(key, value);
    }
  }

  return headers;
}

function jsonError(
  request: Request,
  message: string,
  status: number,
  requestId: string,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json");

  return new Response(
    JSON.stringify({ error: message, requestId }),
    {
      status,
      headers: buildResponseHeaders(request, requestId, headers),
    },
  );
}

function withSharedHeaders(
  request: Request,
  response: Response,
  requestId: string,
): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: buildResponseHeaders(request, requestId, response.headers),
  });
}

function validateOrigin(request: Request, requestId: string): Response | null {
  const originHeader = request.headers.get("origin");
  if (!originHeader || isAllowedOrigin(request, originHeader)) {
    return null;
  }

  return jsonError(
    request,
    "Forbidden origin. Celstate MCP accepts agent clients directly and rejects browser origins unless explicitly allowlisted.",
    403,
    requestId,
  );
}

function buildMethodNotAllowedResponse(
  request: Request,
  message: string,
  requestId: string,
): Response {
  return jsonError(request, message, 405, requestId, {
    Allow: MCP_ALLOWED_METHODS.join(", "),
  });
}

function createMcpServer(toolCtx: McpToolContext): McpServer {
  const server = new McpServer(MCP_SERVER_INFO);

  registerCreditsTools(server, toolCtx);
  registerGenerateTools(server, toolCtx);
  registerGetImageTools(server, toolCtx);
  registerListImageTools(server, toolCtx);

  return server;
}

export async function handleMcpRequest(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const originError = validateOrigin(request, requestId);
  if (originError) {
    return originError;
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: buildResponseHeaders(request, requestId, {
        Allow: MCP_ALLOWED_METHODS.join(", "),
      }),
    });
  }

  if (request.method === "GET") {
    return buildMethodNotAllowedResponse(
      request,
      "This Celstate MCP endpoint is stateless and does not expose a standalone SSE stream. Agent clients should POST JSON-RPC messages to /mcp.",
      requestId,
    );
  }

  if (request.method === "DELETE") {
    return buildMethodNotAllowedResponse(
      request,
      "This Celstate MCP endpoint is stateless and does not support MCP session termination.",
      requestId,
    );
  }

  if (request.method !== "POST") {
    return buildMethodNotAllowedResponse(
      request,
      "Method not allowed. Send MCP requests with POST.",
      requestId,
    );
  }

  // --- Auth ---

  const rawKey = parseBearerToken(request.headers.get("authorization"));
  if (!rawKey) {
    return jsonError(
      request,
      "Missing or malformed bearer token. Add the user's Celstate API key in the Authorization header.",
      401,
      requestId,
      {
        "WWW-Authenticate": 'Bearer realm="celstate-mcp"',
      },
    );
  }

  const keyHash = await sha256Hex(rawKey);
  const auth = await ctx.runMutation(internal.mcp.keys.authenticateKeyByHash, {
    keyHash,
  });

  if (!auth) {
    return jsonError(
      request,
      "Invalid API key. Generate a new key at celstate.com and reconnect.",
      401,
      requestId,
      {
        "WWW-Authenticate": 'Bearer realm="celstate-mcp"',
      },
    );
  }

  // --- MCP ---

  const toolCtx: McpToolContext = {
    runQuery: ctx.runQuery.bind(ctx),
    runMutation: ctx.runMutation.bind(ctx),
    user: auth.user,
    requestId,
  };

  const server = createMcpServer(toolCtx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return withSharedHeaders(request, response, requestId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal MCP error";
    return jsonError(request, message, 500, requestId);
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
