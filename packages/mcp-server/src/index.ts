import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  authenticateRequest,
  AuthenticationError,
  type CelstateRequestContext,
} from "./auth.js";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  HEALTH_ENDPOINT_PATH,
  MCP_ENDPOINT_PATH,
  MCP_SERVER_INFO,
} from "./constants.js";
import { getConvexUrl } from "./convex-client.js";
import { registerGenerateTools } from "./tools/generate.js";
import { registerGetImageTools } from "./tools/getImage.js";
import { registerListImageTools } from "./tools/listImages.js";
import { registerCreditsTools } from "./tools/credits.js";

type AuthenticatedRequest = Request & {
  celstate?: CelstateRequestContext;
};

const PORT = parsePort(process.env.PORT);
const HOST = process.env.HOST ?? DEFAULT_HOST;

function parsePort(portValue: string | undefined): number {
  const parsedPort = parseInt(portValue ?? `${DEFAULT_PORT}`, 10);
  return Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
}

function getAllowedOrigins(): string[] {
  const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS;
  if (!allowedOrigins) {
    return [];
  }

  return allowedOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function isAllowedOrigin(originHeader: string, hostHeader: string | undefined): boolean {
  try {
    const origin = new URL(originHeader);

    if (getAllowedOrigins().includes(origin.origin)) {
      return true;
    }

    return Boolean(hostHeader) && origin.host === hostHeader;
  } catch {
    return false;
  }
}

function validateOriginHeader(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originHeader = req.header("origin");
  if (!originHeader) {
    next();
    return;
  }

  if (isAllowedOrigin(originHeader, req.header("host") ?? undefined)) {
    next();
    return;
  }

  res.status(403).json({
    error: "Forbidden origin. Reconnect from an allowed MCP client origin.",
  });
}

async function requireAuthenticatedRequest(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    req.celstate = await authenticateRequest(req.header("authorization") ?? undefined);
    next();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    next(error);
  }
}

function createMcpServer(context: CelstateRequestContext): McpServer {
  const server = new McpServer(MCP_SERVER_INFO);

  registerCreditsTools(server, context);
  registerGenerateTools(server, context);
  registerGetImageTools(server, context);
  registerListImageTools(server, context);

  return server;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get(HEALTH_ENDPOINT_PATH, (_req, res) => {
  res.json({
    server: `${MCP_SERVER_INFO.name}-mcp`,
    status: "ok",
    version: MCP_SERVER_INFO.version,
  });
});

app.all(
  MCP_ENDPOINT_PATH,
  validateOriginHeader,
  requireAuthenticatedRequest,
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    void handleMcpRequest(req, res).catch(next);
  },
);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Internal server error";
  console.error("Celstate MCP server error", error);

  if (res.headersSent) {
    return;
  }

  res.status(500).json({ error: message });
});

async function handleMcpRequest(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const context = req.celstate;
  if (!context) {
    throw new Error("Authenticated MCP request context was not initialized.");
  }

  const server = createMcpServer(context);
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(
      req,
      res,
      req.method === "POST" ? req.body : undefined,
    );
  } finally {
    await server.close().catch(() => undefined);
  }
}

// Fail fast on startup if required configuration is missing.
getConvexUrl();

app.listen(PORT, HOST, () => {
  console.error(`Celstate MCP server listening on http://${HOST}:${PORT}${MCP_ENDPOINT_PATH}`);
  console.error(`Health check: http://${HOST}:${PORT}${HEALTH_ENDPOINT_PATH}`);
});
