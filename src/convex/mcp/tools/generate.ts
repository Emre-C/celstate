import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { internal } from "../../_generated/api.js";
import {
  GENERATE_TOOL_ANNOTATIONS,
  MAX_GENERATION_PROMPT_LENGTH,
  VALID_ASPECT_RATIOS,
} from "../constants.js";
import {
  createErrorResult,
  createTextResult,
  getErrorMessage,
  truncateText,
} from "../toolResults.js";
import type { McpToolContext } from "../handler.js";

export function registerGenerateTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "celstate_generate",
    {
      annotations: GENERATE_TOOL_ANNOTATIONS,
      description:
        "Generate a transparent-background PNG image from a text prompt. Best for logos, icons, mascots, stickers, UI elements, and game assets. Costs 1 credit per generation. Check credits first with celstate_check_credits. Returns a generation ID \u2014 poll with celstate_get_image until complete (typically 15\u201345 seconds).",
      inputSchema: {
        aspect_ratio: z
          .enum(VALID_ASPECT_RATIOS)
          .default("1:1")
          .describe(
            "Aspect ratio. Common: 1:1 (square), 4:3 (landscape), 3:4 (portrait), 16:9 (widescreen).",
          ),
        prompt: z
          .string()
          .min(1)
          .max(MAX_GENERATION_PROMPT_LENGTH)
          .describe(
            "Describe the subject to generate. Be specific about the subject, style, colors, and composition. Optimized for: logos, icons, mascots, stickers, UI elements, game assets. The background is automatically removed \u2014 do not include background descriptions in the prompt.",
          ),
      },
      title: "Generate transparent image",
    },
    async ({ prompt, aspect_ratio }) => {
      try {
        const generationId: string = await ctx.runMutation(
          internal.generations.requestGenerationForMcp,
          {
            userId: ctx.user._id,
            prompt,
            aspectRatio: aspect_ratio,
          },
        );

        return createTextResult(
          [
            "Generation started.",
            `ID: ${generationId}`,
            `Prompt: "${truncateText(prompt, 100)}"`,
            `Aspect ratio: ${aspect_ratio}`,
            "",
            "Use celstate_get_image with this ID to check progress and get the download URL.",
          ].join("\n"),
        );
      } catch (error) {
        const message = getErrorMessage(error);

        if (message.includes("Insufficient credits")) {
          return createErrorResult(
            "Insufficient credits. The user needs to purchase more credits at celstate.com before generating images.",
          );
        }

        if (message.includes("Too many")) {
          return createErrorResult(
            "Too many concurrent generations. Wait for an in-progress generation to finish, then try again.",
          );
        }

        return createErrorResult(`Generation failed: ${message}`);
      }
    },
  );
}
