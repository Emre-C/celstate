import { z } from "zod";
import { getGenerationById } from "../convex-client.js";
import { createErrorResult, createTextResult, getErrorMessage, READ_ONLY_TOOL_ANNOTATIONS, truncateText, } from "../tool-results.js";
export function registerGetImageTools(server, context) {
    server.registerTool("celstate_get_image", {
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
        description: "Get the status and download URL of a generation by its ID. Returns status (generating/complete/failed), progress stage, and download URL when complete.",
        inputSchema: {
            generation_id: z.string()
                .describe("The generation ID returned by celstate_generate."),
        },
        title: "Get image status",
    }, async ({ generation_id }) => {
        try {
            const generation = await getGenerationById(context.convex, generation_id);
            if (!generation) {
                return createErrorResult(`Generation not found: ${generation_id}. Verify the ID is correct and belongs to the authenticated user.`);
            }
            if (generation.status === "generating") {
                return createTextResult([
                    "Status: generating",
                    generation.statusMessage ? `Progress: ${generation.statusMessage}` : "",
                    "",
                    "The image is still being created. Call celstate_get_image again in 5–10 seconds.",
                ].filter(Boolean).join("\n"));
            }
            if (generation.status === "failed") {
                return createErrorResult([
                    "Status: failed",
                    generation.error ? `Reason: ${generation.error}` : "",
                    "",
                    "The generation failed. The user's credit has been refunded. Try again with a different prompt.",
                ].filter(Boolean).join("\n"));
            }
            const lines = [
                "Status: complete",
                `Prompt: "${truncateText(generation.prompt, 80)}"`,
                `Aspect ratio: ${generation.aspectRatio}`,
            ];
            if (generation.optimizedUrl) {
                lines.push(`Download URL: ${generation.optimizedUrl}`);
            }
            else if (generation.resultUrl) {
                lines.push(`Download URL: ${generation.resultUrl}`);
            }
            if (typeof generation.generationTimeMs === "number") {
                lines.push(`Generation time: ${(generation.generationTimeMs / 1000).toFixed(1)}s`);
            }
            return createTextResult(lines.join("\n"));
        }
        catch (error) {
            return createErrorResult(`Failed to get generation: ${getErrorMessage(error)}`);
        }
    });
}
