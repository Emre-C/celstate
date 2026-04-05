import { z } from "zod";
import { DEFAULT_LIST_IMAGES_LIMIT, MAX_LIST_IMAGES_LIMIT, } from "../constants.js";
import { listGenerations } from "../convex-client.js";
import { createErrorResult, createTextResult, getErrorMessage, READ_ONLY_TOOL_ANNOTATIONS, truncateText, } from "../tool-results.js";
export function registerListImageTools(server, context) {
    server.registerTool("celstate_list_images", {
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
        description: "List the user's recent image generations. Returns up to 10 results, newest first. Each entry includes the generation ID, prompt snippet, status, and download URL if complete.",
        inputSchema: {
            limit: z.number()
                .int()
                .min(1)
                .max(MAX_LIST_IMAGES_LIMIT)
                .default(DEFAULT_LIST_IMAGES_LIMIT)
                .describe("Number of results to return (max 10)."),
            status: z.enum(["all", "complete", "generating", "failed"])
                .default("all")
                .describe("Filter by generation status. Defaults to all."),
        },
        title: "List recent images",
    }, async ({ status, limit }) => {
        try {
            const generations = await listGenerations(context.convex, { limit, status });
            if (generations.length === 0) {
                return createTextResult(status === "all"
                    ? "No generations found. Use celstate_generate to create one."
                    : `No generations with status "${status}".`);
            }
            const lines = generations.map((generation, index) => {
                const parts = [
                    `${index + 1}. [${generation.status}] "${truncateText(generation.prompt, 60)}"`,
                    `   ID: ${generation._id}`,
                    `   Aspect: ${generation.aspectRatio}`,
                ];
                if (generation.status === "complete" && (generation.optimizedUrl || generation.resultUrl)) {
                    parts.push(`   URL: ${generation.optimizedUrl ?? generation.resultUrl}`);
                }
                if (generation.status === "generating" && generation.statusMessage) {
                    parts.push(`   Progress: ${generation.statusMessage}`);
                }
                return parts.join("\n");
            });
            return createTextResult([
                `Showing ${generations.length} generation${generations.length === 1 ? "" : "s"}:`,
                "",
                ...lines,
            ].join("\n"));
        }
        catch (error) {
            return createErrorResult(`Failed to list generations: ${getErrorMessage(error)}`);
        }
    });
}
