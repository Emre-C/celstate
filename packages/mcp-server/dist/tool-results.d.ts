import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export declare const READ_ONLY_TOOL_ANNOTATIONS: {
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: false;
    readOnlyHint: true;
};
export declare const GENERATE_TOOL_ANNOTATIONS: {
    destructiveHint: false;
    idempotentHint: false;
    openWorldHint: true;
    readOnlyHint: false;
};
export declare function createTextResult(text: string): CallToolResult;
export declare function createErrorResult(text: string): CallToolResult;
export declare function getErrorMessage(error: unknown): string;
export declare function truncateText(value: string, maxLength: number): string;
