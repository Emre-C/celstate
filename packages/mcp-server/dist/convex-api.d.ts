import { makeFunctionReference, type FunctionReturnType } from "convex/server";
import type { GenericId } from "convex/values";
import type { GenerationStatusFilter } from "./constants.js";
export type UserId = GenericId<"users">;
export type GenerationId = GenericId<"generations">;
type QueryRef<TArgs extends Record<string, unknown>, TReturn> = ReturnType<typeof makeFunctionReference<"query", TArgs, TReturn>>;
type MutationRef<TArgs extends Record<string, unknown>, TReturn> = ReturnType<typeof makeFunctionReference<"mutation", TArgs, TReturn>>;
export interface CelstateCurrentUserRecord {
    _id: UserId;
    credits?: number | null;
    email?: string | null;
}
export interface CelstateGenerationRecord {
    _id: GenerationId;
    aspectRatio: string;
    error?: string;
    generationTimeMs?: number;
    optimizedUrl: string | null;
    prompt: string;
    resultUrl: string | null;
    status: Exclude<GenerationStatusFilter, "all">;
    statusMessage?: string;
}
export declare const celstateApi: {
    readonly generations: {
        readonly getByUserAndIdWithUrls: QueryRef<{
            generationId: string;
        }, CelstateGenerationRecord | null>;
        readonly listByUserWithUrls: QueryRef<{
            limit?: number;
            status?: Exclude<GenerationStatusFilter, "all">;
        }, CelstateGenerationRecord[]>;
        readonly requestGeneration: MutationRef<{
            aspectRatio: string;
            prompt: string;
        }, GenerationId>;
    };
    readonly users: {
        readonly getMe: QueryRef<{}, CelstateCurrentUserRecord | null>;
    };
};
export type CelstateCurrentUser = NonNullable<FunctionReturnType<typeof celstateApi.users.getMe>>;
export type CelstateGeneration = NonNullable<FunctionReturnType<typeof celstateApi.generations.getByUserAndIdWithUrls>>;
export type CelstateGenerationListItem = FunctionReturnType<typeof celstateApi.generations.listByUserWithUrls>[number];
export {};
