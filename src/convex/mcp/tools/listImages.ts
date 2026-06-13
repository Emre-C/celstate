import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { internal } from "../../_generated/api.js";
import {
  DEFAULT_LIST_IMAGES_LIMIT,
  MAX_LIST_IMAGES_LIMIT,
  READ_ONLY_TOOL_ANNOTATIONS,
} from "../constants.js";
import {
  createErrorResult,
  createTextResult,
  getErrorMessage,
  truncateText,
} from "../toolResults.js";
import type { McpToolContext } from "../context.js";

export function registerListImageTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "celstate_list_images",
    {
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "List the user's recent image generations, newest first. Returns up to 10 results. Each entry includes the generation ID, prompt, status, and download URL if complete. Use this to find a previous generation or check on recent work.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_IMAGES_LIMIT)
          .default(DEFAULT_LIST_IMAGES_LIMIT)
          .describe("Number of results to return (max 10)."),
        status: z
          .enum(["all", "complete", "generating", "failed"])
          .default("all")
          .describe("Filter by generation status. Defaults to all."),
      },
      title: "List recent images",
    },
    async ({ status, limit }) => {
      try {
        const generations = await ctx.runQuery(
          internal.generations.listGenerationsForMcp,
          {
            userId: ctx.user._id,
            limit,
            status: status === "all" ? undefined : status,
          },
        );

        if (generations.length === 0) {
          return createTextResult(
            status === "all"
              ? "No generations found. Use celstate_generate to create one."
              : `No generations with status "${status}".`,
          );
        }

        const lines = generations.map(
          (generation, index) => {
            const parts = [
              `${index + 1}. [${generation.status}] "${truncateText(String(generation.prompt), 60)}"`,
              `   ID: ${generation._id}`,
              `   Aspect: ${generation.aspectRatio}`,
            ];

            if (
              generation.status === "complete" &&
              (generation.optimizedUrl || generation.resultUrl)
            ) {
              parts.push(
                `   URL: ${generation.optimizedUrl ?? generation.resultUrl}`,
              );
            }

            if (
              generation.status === "generating" &&
              generation.statusMessage
            ) {
              parts.push(`   Progress: ${generation.statusMessage}`);
            }

            return parts.join("\n");
          },
        );

        return createTextResult(
          [
            `Showing ${generations.length} generation${generations.length === 1 ? "" : "s"}:`,
            "",
            ...lines,
          ].join("\n"),
        );
      } catch (error) {
        return createErrorResult(
          `Failed to list generations: ${getErrorMessage(error)}`,
        );
      }
    },
  );
}
