import { ConvexHttpClient } from "convex/browser";
import {
  DEFAULT_LIST_IMAGES_LIMIT,
  MAX_LIST_IMAGES_LIMIT,
  type GenerationStatusFilter,
} from "./constants.js";
import {
  celstateApi,
  type CelstateCurrentUser,
  type CelstateGeneration,
  type CelstateGenerationListItem,
  type GenerationId,
} from "./convex-api.js";

export type CelstateGenerationRecord = CelstateGeneration;

export function getConvexUrl(): string {
  const url = process.env.CONVEX_URL;
  if (!url) {
    throw new Error(
      "CONVEX_URL environment variable is required. " +
      "Set it to your Convex deployment URL (e.g. https://your-app.convex.cloud).",
    );
  }

  return url;
}

export function createConvexClient(token: string): ConvexHttpClient {
  return new ConvexHttpClient(getConvexUrl(), {
    auth: token,
    logger: false,
  });
}

export async function getCurrentUser(
  client: ConvexHttpClient,
): Promise<CelstateCurrentUser | null> {
  return client.query(celstateApi.users.getMe, {});
}

export async function requestGeneration(
  client: ConvexHttpClient,
  args: {
    aspectRatio: string;
    prompt: string;
  },
): Promise<GenerationId> {
  return client.mutation(celstateApi.generations.requestGeneration, args);
}

export async function getGenerationById(
  client: ConvexHttpClient,
  generationId: string,
): Promise<CelstateGenerationRecord | null> {
  return client.query(celstateApi.generations.getByUserAndIdWithUrls, {
    generationId: generationId as GenerationId,
  });
}

export async function listGenerations(
  client: ConvexHttpClient,
  args: {
    limit?: number;
    status?: GenerationStatusFilter;
  },
): Promise<CelstateGenerationListItem[]> {
  const limit = Math.min(
    Math.max(args.limit ?? DEFAULT_LIST_IMAGES_LIMIT, 1),
    MAX_LIST_IMAGES_LIMIT,
  );

  return client.query(celstateApi.generations.listByUserWithUrls, {
    limit,
    status: args.status === "all" ? undefined : args.status,
  });
}
