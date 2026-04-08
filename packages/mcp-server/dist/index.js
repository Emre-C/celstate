import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticateRequest, AuthenticationError, } from "./auth.js";
import { DEFAULT_HOST, DEFAULT_PORT, HEALTH_ENDPOINT_PATH, MCP_CORS_ALLOWED_HEADERS, MCP_CORS_ALLOWED_METHODS, MCP_CORS_EXPOSED_HEADERS, MCP_ENDPOINT_PATH, MCP_SERVER_INFO, } from "./constants.js";
import { getConvexUrl } from "./convex-client.js";
import { buildRequestLogFields, createRequestTelemetry, logMcpError, logMcpEvent, } from "./logging.js";
import { registerGenerateTools } from "./tools/generate.js";
import { registerGetImageTools } from "./tools/getImage.js";
import { registerListImageTools } from "./tools/listImages.js";
import { registerCreditsTools } from "./tools/credits.js";
const PORT = parsePort(process.env.PORT);
const HOST = process.env.HOST ?? DEFAULT_HOST;
function parsePort(portValue) {
    const parsedPort = parseInt(portValue ?? `${DEFAULT_PORT}`, 10);
    return Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
}
function getAllowedOrigins() {
    const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS;
    if (!allowedOrigins) {
        return [];
    }
    return allowedOrigins
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
}
function isAllowedOrigin(originHeader, hostHeader) {
    try {
        const origin = new URL(originHeader);
        if (getAllowedOrigins().includes(origin.origin)) {
            return true;
        }
        return Boolean(hostHeader) && origin.host === hostHeader;
    }
    catch {
        return false;
    }
}
function applyCorsHeaders(req, res) {
    const originHeader = req.header("origin");
    if (!originHeader) {
        return;
    }
    res.setHeader("Access-Control-Allow-Origin", originHeader);
    res.setHeader("Access-Control-Allow-Headers", MCP_CORS_ALLOWED_HEADERS.join(", "));
    res.setHeader("Access-Control-Allow-Methods", MCP_CORS_ALLOWED_METHODS.join(", "));
    res.setHeader("Access-Control-Expose-Headers", MCP_CORS_EXPOSED_HEADERS.join(", "));
    res.setHeader("Access-Control-Max-Age", "86400");
    res.append("Vary", "Origin");
    res.append("Vary", "Access-Control-Request-Headers");
    res.append("Vary", "Access-Control-Request-Method");
}
function validateOriginHeader(req, res, next) {
    const originHeader = req.header("origin");
    if (!originHeader) {
        next();
        return;
    }
    if (isAllowedOrigin(originHeader, req.header("host") ?? undefined)) {
        applyCorsHeaders(req, res);
        next();
        return;
    }
    logMcpEvent("mcp_origin_rejected", {
        ...buildRequestLogFields(req),
        responseStatus: 403,
    });
    res.status(403).json({
        error: "Forbidden origin. Reconnect from an allowed MCP client origin.",
        requestId: req.celstateTelemetry?.requestId,
    });
}
function handleCorsPreflight(_req, res) {
    res.status(204).end();
}
function handleUnsupportedMcpMethod(req, res) {
    logMcpEvent("mcp_method_not_allowed", {
        ...buildRequestLogFields(req),
        responseStatus: 405,
    });
    res.setHeader("Allow", "OPTIONS, POST");
    res.status(405).json({
        error: "Method not allowed. This stateless MCP endpoint only accepts POST requests.",
        requestId: req.celstateTelemetry?.requestId,
    });
}
async function requireAuthenticatedRequest(req, res, next) {
    try {
        req.celstate = await authenticateRequest(req.header("authorization") ?? undefined, req.celstateTelemetry?.requestId ?? "unknown");
        next();
    }
    catch (error) {
        if (error instanceof AuthenticationError) {
            logMcpEvent("mcp_auth_rejected", {
                ...buildRequestLogFields(req),
                responseStatus: error.statusCode,
            });
            res.status(error.statusCode).json({
                error: error.message,
                requestId: req.celstateTelemetry?.requestId,
            });
            return;
        }
        next(error);
    }
}
function createMcpServer(context) {
    const server = new McpServer(MCP_SERVER_INFO);
    registerCreditsTools(server, context);
    registerGenerateTools(server, context);
    registerGetImageTools(server, context);
    registerListImageTools(server, context);
    return server;
}
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
    req.celstateTelemetry = createRequestTelemetry(req);
    res.setHeader("x-request-id", req.celstateTelemetry.requestId);
    next();
});
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
    if (req.celstateTelemetry) {
        const refreshedTelemetry = createRequestTelemetry(req);
        req.celstateTelemetry = {
            ...refreshedTelemetry,
            requestId: req.celstateTelemetry.requestId,
            startedAt: req.celstateTelemetry.startedAt,
        };
    }
    next();
});
app.get(HEALTH_ENDPOINT_PATH, (_req, res) => {
    res.json({
        server: `${MCP_SERVER_INFO.name}-mcp`,
        status: "ok",
        version: MCP_SERVER_INFO.version,
    });
});
app.options(MCP_ENDPOINT_PATH, validateOriginHeader, handleCorsPreflight);
app.get(MCP_ENDPOINT_PATH, validateOriginHeader, (req, res) => {
    handleUnsupportedMcpMethod(req, res);
});
app.delete(MCP_ENDPOINT_PATH, validateOriginHeader, (req, res) => {
    handleUnsupportedMcpMethod(req, res);
});
app.post(MCP_ENDPOINT_PATH, validateOriginHeader, requireAuthenticatedRequest, (req, res, next) => {
    void handleMcpRequest(req, res).catch(next);
});
app.use((error, _req, res, _next) => {
    const req = _req;
    const message = error instanceof Error ? error.message : "Internal server error";
    logMcpError("mcp_request_failed", error, {
        ...buildRequestLogFields(req),
        responseStatus: res.statusCode >= 400 ? res.statusCode : 500,
    });
    if (res.headersSent) {
        return;
    }
    res.status(500).json({
        error: message,
        requestId: req.celstateTelemetry?.requestId,
    });
});
async function handleMcpRequest(req, res) {
    const context = req.celstate;
    if (!context) {
        throw new Error("Authenticated MCP request context was not initialized.");
    }
    logMcpEvent("mcp_request_started", buildRequestLogFields(req));
    const server = createMcpServer(context);
    const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: undefined,
    });
    let cleanedUp = false;
    res.once("close", () => {
        if (cleanedUp) {
            return;
        }
        cleanedUp = true;
        logMcpEvent("mcp_request_finished", {
            ...buildRequestLogFields(req),
            durationMs: Date.now() - (req.celstateTelemetry?.startedAt ?? Date.now()),
            responseStatus: res.statusCode,
        });
        void (async () => {
            await transport.close().catch((closeError) => {
                logMcpError("mcp_transport_close_failed", closeError, buildRequestLogFields(req));
            });
            await server.close().catch((closeError) => {
                logMcpError("mcp_server_close_failed", closeError, buildRequestLogFields(req));
            });
        })();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
}
// Fail fast on startup if required configuration is missing.
getConvexUrl();
logMcpEvent("mcp_server_starting", {
    allowedOriginCount: getAllowedOrigins().length,
    healthEndpointPath: HEALTH_ENDPOINT_PATH,
    host: HOST,
    mcpEndpointPath: MCP_ENDPOINT_PATH,
    port: PORT,
    transport: "streamable_http",
});
app.listen(PORT, HOST, () => {
    logMcpEvent("mcp_server_listening", {
        healthUrl: `http://${HOST}:${PORT}${HEALTH_ENDPOINT_PATH}`,
        mcpUrl: `http://${HOST}:${PORT}${MCP_ENDPOINT_PATH}`,
    });
});
