import type { Doc, Id } from "../_generated/dataModel.js";
import { GENERATION_CONFIG } from "./config.js";

export type StorageDeleteReason =
  | "expired_retention"
  | "orphan_cleanup"
  | "qa_user_reset";

/** Minimum age before generation and Lottie artifacts may be deleted. */
export const GENERATION_ARTIFACT_RETENTION_MS =
  GENERATION_CONFIG.generationArtifactRetentionMs;

export function computeExpiredArtifactCutoff(nowMs: number): number {
  return nowMs - GENERATION_ARTIFACT_RETENTION_MS;
}

/**
 * Rejects cutoffs that would delete artifacts newer than the retention window.
 * Call before any bulk storage purge keyed on createdAt.
 */
export function assertRetentionBoundedCutoff(cutoffMs: number, nowMs: number): void {
  const oldestAllowedCutoff = computeExpiredArtifactCutoff(nowMs);
  if (cutoffMs > oldestAllowedCutoff) {
    throw new Error(
      `Refusing storage purge: cutoff is newer than the ${GENERATION_ARTIFACT_RETENTION_MS}ms retention window`,
    );
  }
}

function uniqueStorageIds(ids: Id<"_storage">[]): Id<"_storage">[] {
  return [...new Set(ids.map((id) => String(id)))] as Id<"_storage">[];
}

export function storageIdsFromGeneration(gen: Doc<"generations">): Id<"_storage">[] {
  const ids: Id<"_storage">[] = [];
  const push = (id: Id<"_storage"> | undefined) => {
    if (id !== undefined) ids.push(id);
  };
  push(gen.resultStorageId);
  push(gen.whiteBgStorageId);
  push(gen.blackBgStorageId);
  push(gen.optimizedStorageId);
  if (gen.referenceStorageIds) {
    for (const id of gen.referenceStorageIds) {
      ids.push(id);
    }
  }
  return uniqueStorageIds(ids);
}

export function storageIdsFromLottieGeneration(
  gen: Doc<"lottieGenerations">,
): Id<"_storage">[] {
  const ids: Id<"_storage">[] = [];
  if (gen.lottieStorageId !== undefined) {
    ids.push(gen.lottieStorageId);
  }
  return uniqueStorageIds(ids);
}

export function isTerminalGenerationStatus(status: Doc<"generations">["status"]): boolean {
  return status === "complete" || status === "failed";
}

export function isTerminalLottieGenerationStatus(
  status: Doc<"lottieGenerations">["status"],
): boolean {
  return status === "complete" || status === "failed";
}

export function isGenerationEligibleForRetentionPurge(
  gen: Doc<"generations">,
  cutoffMs: number,
): boolean {
  return isTerminalGenerationStatus(gen.status) && gen.createdAt < cutoffMs;
}

export function isLottieGenerationEligibleForRetentionPurge(
  gen: Doc<"lottieGenerations">,
  cutoffMs: number,
): boolean {
  return isTerminalLottieGenerationStatus(gen.status) && gen.createdAt < cutoffMs;
}
