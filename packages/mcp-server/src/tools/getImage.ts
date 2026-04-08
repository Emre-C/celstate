import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CelstateRequestContext } from "../auth.js";
import { getGenerationById } from "../convex-client.js";
import {
  createErrorResult,
  createTextResult,
  getErrorMessage,
  READ_ONLY_TOOL_ANNOTATIONS,
  truncateText,
} from "../tool-results.js";
import { logToolFailure, logToolResult } from "../logging.js";

export function registerGetImageTools(
  server: McpServer,
  context: CelstateRequestContext,
): void {
  server.registerTool(
    "celstate_get_image",
    {
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description: "Get the status and download URL of a generation by its ID. Returns status (generating/complete/failed), progress stage, and download URL when complete.",
      inputSchema: {
        generation_id: z.string()
          .trim()
          .min(1)
          .describe("The generation ID returned by celstate_generate."),
      },
      title: "Get image status",
    },
    async ({ generation_id }): Promise<CallToolResult> => {
      try {
        const generation = await getGenerationById(context.convex, generation_id);

        if (!generation) {
          logToolResult(context, "celstate_get_image", "returned_error", {
            generationId: generation_id,
            reason: "generation_not_found_or_invalid",
          });
          return createErrorResult(
            `Generation not found: ${generation_id}. Verify the ID is valid and belongs to the authenticated user.`,
          );
        }

        if (generation.status === "generating") {
          logToolResult(context, "celstate_get_image", "succeeded", {
            generationId: generation_id,
            generationStatus: generation.status,
          });
          return createTextResult(
            [
              "Status: generating",
              generation.statusMessage ? `Progress: ${generation.statusMessage}` : "",
              "",
              "The image is still being created. Call celstate_get_image again in 5–10 seconds.",
            ].filter(Boolean).join("\n"),
          );
        }

        if (generation.status === "failed") {
          logToolResult(context, "celstate_get_image", "returned_error", {
            generationId: generation_id,
            generationStatus: generation.status,
          });
          return createErrorResult(
            [
              "Status: failed",
              generation.error ? `Reason: ${generation.error}` : "",
              "",
              "The generation failed. The user's credit has been refunded. Try again with a different prompt.",
            ].filter(Boolean).join("\n"),
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
          lines.push(`Generation time: ${(generation.generationTimeMs / 1000).toFixed(1)}s`);
        }

        logToolResult(context, "celstate_get_image", "succeeded", {
          generationId: generation_id,
          generationStatus: generation.status,
        });

        return createTextResult(lines.join("\n"));
      } catch (error) {
        logToolFailure(context, "celstate_get_image", error, {
          generationId: generation_id,
        });
        return createErrorResult(`Failed to get generation: ${getErrorMessage(error)}`);
      }
    },
  );
}
