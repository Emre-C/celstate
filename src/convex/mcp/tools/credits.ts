import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { internal } from "../../_generated/api.js";
import { READ_ONLY_TOOL_ANNOTATIONS } from "../constants.js";
import { createTextResult } from "../toolResults.js";
import type { McpToolContext } from "../context.js";

export function registerCreditsTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "celstate_check_credits",
    {
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Check how many image generation credits the user has remaining. Each generation costs 1 credit. Call this before celstate_generate. If the user has 0 credits, tell them to purchase more at celstate.com.",
      title: "Check credits",
    },
    async () => {
      const credits: number = await ctx.runQuery(
        internal.generations.getCreditsForMcp,
        { userId: ctx.user._id },
      );
      return createTextResult(`Credits remaining: ${credits}`);
    },
  );
}
