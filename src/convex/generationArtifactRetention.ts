import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";
import { internalMutation, type MutationCtx } from "./_generated/server.js";
import { GENERATION_CONFIG } from "./lib/config.js";
import {
  assertRetentionBoundedCutoff,
  computeExpiredArtifactCutoff,
  isGenerationEligibleForRetentionPurge,
  isLottieGenerationEligibleForRetentionPurge,
} from "./lib/generationArtifactStorage.js";
import {
  deleteGenerationRow,
  deleteLottieGenerationRow,
  flushStorageDeletions,
} from "./lib/generation/userArtifactDeletion.js";

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

    const ids = await deleteGenerationRow(ctx, gen._id, gen);
    storageAcc.push(...ids);
    removed++;
  }

  await flushStorageDeletions(ctx, storageAcc, "expired_retention");

  return removed;
}

async function purgeExpiredLottieGenerations(
  ctx: MutationCtx,
  cutoffMs: number,
): Promise<number> {
  const candidates = await ctx.db
    .query("lottieGenerations")
    .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoffMs))
    .take(GENERATION_CONFIG.expiredGenerationArtifactCleanupBatchSize);

  const storageAcc: Id<"_storage">[] = [];
  let removed = 0;

  for (const gen of candidates) {
    if (!isLottieGenerationEligibleForRetentionPurge(gen, cutoffMs)) {
      continue;
    }

    const ids = await deleteLottieGenerationRow(gen, ctx);
    storageAcc.push(...ids);
    removed++;
  }

  await flushStorageDeletions(ctx, storageAcc, "expired_retention");

  return removed;
}

/**
 * Cron-only retention purge. Deletes terminal generation rows, Lottie rows,
 * and their storage blobs only when `createdAt` is older than the configured
 * retention window (30 days). Never scans or wipes the full table.
 */
export const purgeExpiredGenerationArtifacts = internalMutation({
  args: {},
  returns: v.object({
    generationsRemoved: v.number(),
    lottieGenerationsRemoved: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const cutoffMs = computeExpiredArtifactCutoff(now);
    assertRetentionBoundedCutoff(cutoffMs, now);

    const generationsRemoved = await purgeExpiredStaticGenerations(ctx, cutoffMs);
    const lottieGenerationsRemoved = await purgeExpiredLottieGenerations(
      ctx,
      cutoffMs,
    );

    return { generationsRemoved, lottieGenerationsRemoved };
  },
});
