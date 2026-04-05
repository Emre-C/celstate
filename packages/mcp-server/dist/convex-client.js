import { ConvexHttpClient } from "convex/browser";
import { DEFAULT_LIST_IMAGES_LIMIT, MAX_LIST_IMAGES_LIMIT, } from "./constants.js";
import { celstateApi, } from "./convex-api.js";
export function getConvexUrl() {
    const url = process.env.CONVEX_URL;
    if (!url) {
        throw new Error("CONVEX_URL environment variable is required. " +
            "Set it to your Convex deployment URL (e.g. https://your-app.convex.cloud).");
    }
    return url;
}
export function createConvexClient(token) {
    return new ConvexHttpClient(getConvexUrl(), {
        auth: token,
        logger: false,
    });
}
export async function getCurrentUser(client) {
    return client.query(celstateApi.users.getMe, {});
}
export async function requestGeneration(client, args) {
    return client.mutation(celstateApi.generations.requestGeneration, args);
}
export async function getGenerationById(client, generationId) {
    return client.query(celstateApi.generations.getByUserAndIdWithUrls, {
        generationId: generationId,
    });
}
export async function listGenerations(client, args) {
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIST_IMAGES_LIMIT, 1), MAX_LIST_IMAGES_LIMIT);
    return client.query(celstateApi.generations.listByUserWithUrls, {
        limit,
        status: args.status === "all" ? undefined : args.status,
    });
}
