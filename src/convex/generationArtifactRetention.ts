import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { internalMutation, type MutationCtx } from "./_generated/server.js";
import { GENERATION_CONFIG } from "./lib/config.js";
import {
  assertRetentionBoundedCutoff,
  computeExpiredArtifactCutoff,
  isAnimationGenerationEligibleForRetentionPurge,
  isGenerationEligibleForRetentionPurge,
  storageIdsFromAnimationGeneration,
  storageIdsFromGeneration,
} from "./lib/generationArtifactStorage.js";

async function purgeExpiredStaticGenerations(
  ctx: MutationCtx,
  cutoffMs: number,
): Promise<number> {
  const candidates = await ctx.db
    .query("generations")
    .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoffMs))
    .take(GENERATION_CONFIG.expiredGenerationArtifactCleanupBatchSize);

  const storageAcc: Id<"_storage">[] = [];
  let removed = 0;

  for (const gen of candidates) {
    if (!isGenerationEligibleForRetentionPurge(gen, cutoffMs)) {
      continue;
    }

    storageAcc.push(...storageIdsFromGeneration(gen));
    const events = await ctx.db
      .query("generationOpsEvents")
      .withIndex("by_generation", (q) => q.eq("generationId", gen._id))
      .collect();
    for (const ev of events) {
      await ctx.db.delete("generationOpsEvents", ev._id);
    }
    await ctx.db.delete("generations", gen._id);
    removed++;
  }

  if (storageAcc.length > 0) {
    await ctx.runMutation(internal.generations.deleteStorageFiles, {
      storageIds: storageAcc,
      reason: "expired_retention",
    });
  }

  return removed;
}

async function purgeExpiredAnimationGenerations(
  ctx: MutationCtx,
  cutoffMs: number,
): Promise<number> {
  const candidates = await ctx.db
    .query("animationGenerations")
    .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoffMs))
    .take(GENERATION_CONFIG.expiredGenerationArtifactCleanupBatchSize);

  const storageAcc: Id<"_storage">[] = [];
  let removed = 0;

  for (const gen of candidates) {
    if (!isAnimationGenerationEligibleForRetentionPurge(gen, cutoffMs)) {
      continue;
    }

    storageAcc.push(...storageIdsFromAnimationGeneration(gen));
    await ctx.db.delete("animationGenerations", gen._id);
    removed++;
  }

  if (storageAcc.length > 0) {
    await ctx.runMutation(internal.generations.deleteStorageFiles, {
      storageIds: storageAcc,
      reason: "expired_retention",
    });
  }

  return removed;
}

/**
 * Cron-only retention purge. Deletes terminal generation / animation rows and
 * their storage blobs only when `createdAt` is older than the configured
 * retention window (30 days). Never scans or wipes the full table.
 */
export const purgeExpiredGenerationArtifacts = internalMutation({
  args: {},
  returns: v.object({
    animationGenerationsRemoved: v.number(),
    generationsRemoved: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const cutoffMs = computeExpiredArtifactCutoff(now);
    assertRetentionBoundedCutoff(cutoffMs, now);

    const generationsRemoved = await purgeExpiredStaticGenerations(ctx, cutoffMs);
    const animationGenerationsRemoved = await purgeExpiredAnimationGenerations(
      ctx,
      cutoffMs,
    );

    return { generationsRemoved, animationGenerationsRemoved };
  },
});
