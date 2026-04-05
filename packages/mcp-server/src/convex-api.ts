import {
  makeFunctionReference,
  type FunctionReturnType,
} from "convex/server";
import type { GenericId } from "convex/values";
import type { GenerationStatusFilter } from "./constants.js";

export type UserId = GenericId<"users">;
export type GenerationId = GenericId<"generations">;

type QueryRef<TArgs extends Record<string, unknown>, TReturn> = ReturnType<
  typeof makeFunctionReference<"query", TArgs, TReturn>
>;
type MutationRef<TArgs extends Record<string, unknown>, TReturn> = ReturnType<
  typeof makeFunctionReference<"mutation", TArgs, TReturn>
>;

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

export const celstateApi = {
  generations: {
    getByUserAndIdWithUrls: makeFunctionReference<
      "query",
      { generationId: GenerationId },
      CelstateGenerationRecord | null
    >("generations:getByUserAndIdWithUrls") as QueryRef<
      { generationId: GenerationId },
      CelstateGenerationRecord | null
    >,
    listByUserWithUrls: makeFunctionReference<
      "query",
      {
        limit?: number;
        status?: Exclude<GenerationStatusFilter, "all">;
      },
      CelstateGenerationRecord[]
    >("generations:listByUserWithUrls") as QueryRef<
      {
        limit?: number;
        status?: Exclude<GenerationStatusFilter, "all">;
      },
      CelstateGenerationRecord[]
    >,
    requestGeneration: makeFunctionReference<
      "mutation",
      {
        aspectRatio: string;
        prompt: string;
      },
      GenerationId
    >("generations:requestGeneration") as MutationRef<
      {
        aspectRatio: string;
        prompt: string;
      },
      GenerationId
    >,
  },
  users: {
    getMe: makeFunctionReference<"query", {}, CelstateCurrentUserRecord | null>(
      "users:getMe",
    ) as QueryRef<{}, CelstateCurrentUserRecord | null>,
  },
} as const;

export type CelstateCurrentUser = NonNullable<
  FunctionReturnType<typeof celstateApi.users.getMe>
>;
export type CelstateGeneration = NonNullable<
  FunctionReturnType<typeof celstateApi.generations.getByUserAndIdWithUrls>
>;
export type CelstateGenerationListItem = FunctionReturnType<
  typeof celstateApi.generations.listByUserWithUrls
>[number];
