import { z } from "zod";
import { MAX_GENERATION_PROMPT_LENGTH, VALID_ASPECT_RATIOS, } from "../constants.js";
import { requestGeneration } from "../convex-client.js";
import { createErrorResult, createTextResult, GENERATE_TOOL_ANNOTATIONS, getErrorMessage, truncateText, } from "../tool-results.js";
import { logToolFailure, logToolResult } from "../logging.js";
export function registerGenerateTools(server, context) {
    server.registerTool("celstate_generate", {
        annotations: GENERATE_TOOL_ANNOTATIONS,
        description: "Generate a transparent-background image (PNG) from a text prompt. Costs 1 credit. Returns a generation ID to poll with celstate_get_image. Generation typically takes 15–45 seconds.",
        inputSchema: {
            aspect_ratio: z.enum(VALID_ASPECT_RATIOS)
                .default("1:1")
                .describe("Aspect ratio. Common: 1:1 (square), 4:3 (landscape), 3:4 (portrait), 16:9 (widescreen)."),
            prompt: z.string()
                .min(1)
                .max(MAX_GENERATION_PROMPT_LENGTH)
                .describe("Description of the image to generate. Be specific about the subject, style, and composition."),
        },
        title: "Generate transparent image",
    }, async ({ prompt, aspect_ratio }) => {
        try {
            const generationId = await requestGeneration(context.convex, {
                aspectRatio: aspect_ratio,
                prompt,
            });
            logToolResult(context, "celstate_generate", "succeeded", {
                aspectRatio: aspect_ratio,
                generationId,
            });
            return createTextResult([
                "Generation started.",
                `ID: ${generationId}`,
                `Prompt: "${truncateText(prompt, 100)}"`,
                `Aspect ratio: ${aspect_ratio}`,
                "",
                "Use celstate_get_image with this ID to check progress and get the download URL.",
            ].join("\n"));
        }
        catch (error) {
            const message = getErrorMessage(error);
            if (message.includes("Insufficient credits")) {
                logToolResult(context, "celstate_generate", "returned_error", {
                    reason: "insufficient_credits",
                });
                return createErrorResult("Insufficient credits. The user needs to purchase more credits at celstate.com before generating images.");
            }
            if (message.includes("Too many generations")) {
                logToolResult(context, "celstate_generate", "returned_error", {
                    reason: "too_many_generations",
                });
                return createErrorResult("Too many concurrent generations. Wait for an in-progress generation to finish, then try again.");
            }
            logToolFailure(context, "celstate_generate", error);
            return createErrorResult(`Generation failed: ${message}`);
        }
    });
}
