export const MCP_SERVER_INFO = {
  name: "celstate",
  version: "0.1.0",
} as const;

export const MCP_ENDPOINT_PATH = "/mcp";
export const HEALTH_ENDPOINT_PATH = "/health";

export const MCP_CORS_ALLOWED_METHODS = [
  "DELETE",
  "GET",
  "OPTIONS",
  "POST",
] as const;

export const MCP_CORS_ALLOWED_HEADERS = [
  "Accept",
  "Authorization",
  "Content-Type",
  "Last-Event-ID",
  "Mcp-Session-Id",
  "MCP-Protocol-Version",
] as const;

export const MCP_CORS_EXPOSED_HEADERS = [
  "Mcp-Session-Id",
  "x-request-id",
] as const;

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3100;

export const DEFAULT_LIST_IMAGES_LIMIT = 5;
export const MAX_LIST_IMAGES_LIMIT = 10;

export const MAX_GENERATION_PROMPT_LENGTH = 20_000;

export const VALID_ASPECT_RATIOS = [
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
  "4:1",
  "1:4",
  "8:1",
  "1:8",
] as const;

export type CelstateAspectRatio = (typeof VALID_ASPECT_RATIOS)[number];
export type GenerationStatusFilter = "all" | "complete" | "generating" | "failed";
