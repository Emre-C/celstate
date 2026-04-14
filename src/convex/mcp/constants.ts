import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export const MCP_SERVER_INFO = {
  name: "celstate",
  version: "0.1.0",
  instructions: "Celstate generates transparent-background PNG images from text prompts. Use it when the user needs logos, icons, mascots, stickers, UI elements, or game assets with no background. Each generation costs 1 credit. Check credits with celstate_check_credits before generating. If the user has 0 credits, direct them to celstate.com to purchase more. After calling celstate_generate, poll celstate_get_image every 5\u201310 seconds until the status is 'complete' or 'failed'. Typical generation time is 15\u201345 seconds.",
} as const;

export const READ_ONLY_TOOL_ANNOTATIONS: ToolAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
};

export const GENERATE_TOOL_ANNOTATIONS: ToolAnnotations = {
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
  readOnlyHint: false,
};

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

export const MAX_GENERATION_PROMPT_LENGTH = 20_000;
export const DEFAULT_LIST_IMAGES_LIMIT = 5;
export const MAX_LIST_IMAGES_LIMIT = 10;
export const MAX_ACTIVE_KEYS_PER_USER = 5;

export const MCP_ALLOWED_METHODS = ["OPTIONS", "POST"] as const;

export const MCP_CORS_ALLOWED_HEADERS = [
  "Accept",
  "Authorization",
  "Content-Type",
  "MCP-Protocol-Version",
] as const;

export const MCP_CORS_EXPOSED_HEADERS = ["x-request-id"] as const;
