import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CelstateRequestContext } from "../auth.js";
import {
  createTextResult,
  READ_ONLY_TOOL_ANNOTATIONS,
} from "../tool-results.js";

export function registerCreditsTools(
  server: McpServer,
  context: CelstateRequestContext,
): void {
  server.registerTool(
    "celstate_check_credits",
    {
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description: "Check how many image generation credits the user has remaining. Each generation costs 1 credit.",
      title: "Check credits",
    },
    async (): Promise<CallToolResult> => {
      return createTextResult(`Credits remaining: ${context.user.credits ?? 0}`);
    },
  );
}
