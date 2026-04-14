import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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
  return `${value.slice(0, maxLength)}\u2026`;
}
