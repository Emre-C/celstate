import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export const READ_ONLY_TOOL_ANNOTATIONS = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} satisfies ToolAnnotations;

export const GENERATE_TOOL_ANNOTATIONS = {
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
  readOnlyHint: false,
} satisfies ToolAnnotations;

export function createTextResult(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
  };
}

export function createErrorResult(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown error";
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}…`;
}
