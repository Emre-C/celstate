import type { Id } from "../../_generated/dataModel.js";
import type { MutationCtx } from "../../_generated/server.js";
import { internal } from "../../_generated/api.js";
import {
  storageIdsFromGeneration,
  storageIdsFromLottieGeneration,
} from "../generationArtifactStorage.js";
import type { StorageDeleteReason } from "../generationArtifactStorage.js";

const STORAGE_BATCH_LIMIT = 80;

/**
 * Deletes a single generation row, its child ops events, and queues
 * storage deletion. Returns the storage IDs collected.
 */
export async function deleteGenerationRow(
  ctx: MutationCtx,
  genId: Id<"generations">,
  gen: Parameters<typeof storageIdsFromGeneration>[0],
): Promise<Id<"_storage">[]> {
  const storageIds = storageIdsFromGeneration(gen);

  const events = await ctx.db
    .query("generationOpsEvents")
    .withIndex("by_generation", (q) => q.eq("generationId", genId))
    .collect();
  for (const ev of events) {
    await ctx.db.delete("generationOpsEvents", ev._id);
  }
  await ctx.db.delete("generations", genId);

  return storageIds;
}

/**
 * Deletes a single lottie generation row and queues storage deletion.
 * Returns the storage IDs collected.
 */
export async function deleteLottieGenerationRow(
  gen: Parameters<typeof storageIdsFromLottieGeneration>[0],
  ctx: MutationCtx,
): Promise<Id<"_storage">[]> {
  const storageIds = storageIdsFromLottieGeneration(gen);
  await ctx.db.delete("lottieGenerations", gen._id);
  return storageIds;
}

/**
 * Flushes accumulated storage IDs to the storage deletion mutation.
 */
export async function flushStorageDeletions(
  ctx: MutationCtx,
  storageIds: Id<"_storage">[],
  reason: StorageDeleteReason,
): Promise<void> {
  if (storageIds.length === 0) return;
  await ctx.runMutation(internal.generations.deleteStorageFiles, {
    storageIds,
    reason,
  });
}

/**
 * Iterates all generation rows for a user in batches, deleting each row
 * and its child ops events, then flushing storage deletions per batch.
 * Returns the total number of rows removed.
 */
export async function deleteGenerationsForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
  reason: StorageDeleteReason,
): Promise<number> {
  let removed = 0;
  while (true) {
    const batch = await ctx.db
      .query("generations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(STORAGE_BATCH_LIMIT);

    if (batch.length === 0) break;

    const storageAcc: Id<"_storage">[] = [];
    for (const gen of batch) {
      const ids = await deleteGenerationRow(ctx, gen._id, gen);
      storageAcc.push(...ids);
      removed++;
    }

    await flushStorageDeletions(ctx, storageAcc, reason);
  }
  return removed;
}

/**
 * Iterates all lottie generation rows for a user in batches,
 * deleting each row and flushing storage deletions per batch.
 * Returns the total number of rows removed.
 */
export async function deleteLottieGenerationsForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
  reason: StorageDeleteReason,
): Promise<number> {
  let removed = 0;
  while (true) {
    const batch = await ctx.db
      .query("lottieGenerations")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .take(STORAGE_BATCH_LIMIT);

    if (batch.length === 0) break;

    const storageAcc: Id<"_storage">[] = [];
    for (const gen of batch) {
      const ids = await deleteLottieGenerationRow(gen, ctx);
      storageAcc.push(...ids);
      removed++;
    }

    await flushStorageDeletions(ctx, storageAcc, reason);
  }
  return removed;
}
