import { ConvexHttpClient } from "convex/browser";
import { type GenerationStatusFilter } from "./constants.js";
import { type CelstateCurrentUser, type CelstateGeneration, type CelstateGenerationListItem, type GenerationId } from "./convex-api.js";
export type CelstateGenerationRecord = CelstateGeneration;
export declare function getConvexUrl(): string;
export declare function createConvexClient(token: string): ConvexHttpClient;
export declare function getCurrentUser(client: ConvexHttpClient): Promise<CelstateCurrentUser | null>;
export declare function requestGeneration(client: ConvexHttpClient, args: {
    aspectRatio: string;
    prompt: string;
}): Promise<GenerationId>;
export declare function getGenerationById(client: ConvexHttpClient, generationId: string): Promise<CelstateGenerationRecord | null>;
export declare function listGenerations(client: ConvexHttpClient, args: {
    limit?: number;
    status?: GenerationStatusFilter;
}): Promise<CelstateGenerationListItem[]>;
