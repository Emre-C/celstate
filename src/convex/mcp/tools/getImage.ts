import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { internal } from "../../_generated/api.js";
import { READ_ONLY_TOOL_ANNOTATIONS } from "../constants.js";
import {
  createErrorResult,
  createTextResult,
  getErrorMessage,
  truncateText,
} from "../toolResults.js";
import type { McpToolContext } from "../handler.js";

export function registerGetImageTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "celstate_get_image",
    {
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Get the status and download URL of a generation by its ID. Poll every 5\u201310 seconds after calling celstate_generate. Returns status (generating/complete/failed), progress details, and the download URL when complete.",
      inputSchema: {
        generation_id: z
          .string()
          .trim()
          .min(1)
          .describe("The generation ID returned by celstate_generate."),
      },
      title: "Get image status",
    },
    async ({ generation_id }) => {
      try {
        const generation = await ctx.runQuery(
          internal.generations.getGenerationForMcp,
          { userId: ctx.user._id, generationId: generation_id },
        );

        if (!generation) {
          return createErrorResult(
            `Generation not found: ${generation_id}. Verify the ID is valid and belongs to the authenticated user.`,
          );
        }

        if (generation.status === "generating") {
          return createTextResult(
            [
              "Status: generating",
              generation.statusMessage ? `Progress: ${generation.statusMessage}` : "",
              "",
              "The image is still being created. Poll again in 5\u201310 seconds. Typical total time: 15\u201345 seconds. If still generating after 2 minutes, it may have stalled \u2014 inform the user.",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }

        if (generation.status === "failed") {
          return createErrorResult(
            [
              "Status: failed",
              generation.error ? `Reason: ${generation.error}` : "",
              "",
              "The generation failed. The user's credit has been refunded. Try again with a different prompt.",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }

        const lines = [
          "Status: complete",
          `Prompt: "${truncateText(generation.prompt, 80)}"`,
          `Aspect ratio: ${generation.aspectRatio}`,
        ];

        if (generation.optimizedUrl) {
          lines.push(`Download URL: ${generation.optimizedUrl}`);
        } else if (generation.resultUrl) {
          lines.push(`Download URL: ${generation.resultUrl}`);
        }

        if (typeof generation.generationTimeMs === "number") {
          lines.push(
            `Generation time: ${(generation.generationTimeMs / 1000).toFixed(1)}s`,
          );
        }

        return createTextResult(lines.join("\n"));
      } catch (error) {
        return createErrorResult(
          `Failed to get generation: ${getErrorMessage(error)}`,
        );
      }
    },
  );
}
