import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { CelstateRequestContext } from "./auth.js";

export interface McpRequestTelemetry {
  requestId: string;
  startedAt: number;
}

type LogFields = Record<string, unknown>;

export function createRequestTelemetry(_req: Request): McpRequestTelemetry {
  return {
    requestId: randomUUID(),
    startedAt: Date.now(),
  };
}

export function buildRequestLogFields(
  req: Request & { celstateTelemetry?: McpRequestTelemetry },
): LogFields {
  const userAgent = req.header("user-agent");
  const origin = req.header("origin");
  return {
    requestId: req.celstateTelemetry?.requestId,
    method: req.method,
    path: req.path,
    ...(userAgent ? { userAgent } : {}),
    ...(origin ? { origin } : {}),
  };
}

export function logMcpEvent(event: string, fields: LogFields): void {
  console.error(
    JSON.stringify({
      level: "info",
      event,
      ts: new Date().toISOString(),
      ...fields,
    }),
  );
}

export function logMcpError(
  event: string,
  error: unknown,
  fields: LogFields,
): void {
  const err =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { value: error };
  console.error(
    JSON.stringify({
      level: "error",
      event,
      ts: new Date().toISOString(),
      err,
      ...fields,
    }),
  );
}

export function logToolResult(
  context: CelstateRequestContext,
  tool: string,
  outcome: string,
  details?: LogFields,
): void {
  logMcpEvent("mcp_tool_result", {
    requestId: context.requestId,
    tool,
    outcome,
    userId: context.user._id,
    ...details,
  });
}

export function logToolFailure(
  context: CelstateRequestContext,
  tool: string,
  error: unknown,
  details?: LogFields,
): void {
  logMcpError("mcp_tool_failure", error, {
    requestId: context.requestId,
    tool,
    userId: context.user._id,
    ...details,
  });
}
