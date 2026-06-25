import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel.js";
import { GENERATION_CONFIG } from "./config.js";
import {
  assertRetentionBoundedCutoff,
  computeExpiredArtifactCutoff,
  isGenerationEligibleForRetentionPurge,
  isLottieGenerationEligibleForRetentionPurge,
  storageIdsFromGeneration,
  storageIdsFromLottieGeneration,
} from "./generationArtifactStorage.js";

describe("generationArtifactStorage", () => {
  it("computeExpiredArtifactCutoff subtracts configured retention", () => {
    const now = 1_700_000_000_000;
    expect(computeExpiredArtifactCutoff(now)).toBe(
      now - GENERATION_CONFIG.generationArtifactRetentionMs,
    );
  });

  it("assertRetentionBoundedCutoff rejects cutoffs inside the retention window", () => {
    const now = 1_700_000_000_000;
    expect(() => assertRetentionBoundedCutoff(now - 1_000, now)).toThrow(/Refusing storage purge/);
    expect(() =>
      assertRetentionBoundedCutoff(computeExpiredArtifactCutoff(now), now),
    ).not.toThrow();
  });

  it("only terminal generations older than cutoff are retention-eligible", () => {
    const cutoff = 1_000;
    const base = {
      _id: "g1" as Id<"generations">,
      _creationTime: 0,
      userId: "u1" as Id<"users">,
      prompt: "p",
      creditsCost: 1,
      aspectRatio: "1:1",
      createdAt: 500,
    } satisfies Partial<Doc<"generations">>;

    expect(
      isGenerationEligibleForRetentionPurge(
        { ...base, status: "complete" } as Doc<"generations">,
        cutoff,
      ),
    ).toBe(true);
    expect(
      isGenerationEligibleForRetentionPurge(
        { ...base, status: "generating", createdAt: 500 } as Doc<"generations">,
        cutoff,
      ),
    ).toBe(false);
    expect(
      isGenerationEligibleForRetentionPurge(
        { ...base, status: "complete", createdAt: 2_000 } as Doc<"generations">,
        cutoff,
      ),
    ).toBe(false);
  });

  it("tracks terminal Lottie generations for retention and storage purge", () => {
    const storageId = "kg_lottie" as Id<"_storage">;
    const base = {
      _id: "l1" as Id<"lottieGenerations">,
      _creationTime: 0,
      userId: "u1" as Id<"users">,
      prompt: "p",
      aspectRatio: "1:1",
      durationSeconds: 4,
      fps: 60,
      attemptCount: 1,
      creditsCost: 0,
      createdAt: 500,
      lottieStorageId: storageId,
    } satisfies Partial<Doc<"lottieGenerations">>;

    expect(storageIdsFromLottieGeneration({
      ...base,
      status: "complete",
    } as Doc<"lottieGenerations">)).toEqual([storageId]);
    expect(isLottieGenerationEligibleForRetentionPurge({
      ...base,
      status: "complete",
    } as Doc<"lottieGenerations">, 1_000)).toBe(true);
    expect(isLottieGenerationEligibleForRetentionPurge({
      ...base,
      status: "generating",
    } as Doc<"lottieGenerations">, 1_000)).toBe(false);
  });

  it("collects all static generation storage fields", () => {
    const result = "s1" as Id<"_storage">;
    const reference = "s2" as Id<"_storage">;
    const ids = storageIdsFromGeneration({
      _id: "g1" as Id<"generations">,
      _creationTime: 0,
      userId: "u1" as Id<"users">,
      prompt: "p",
      status: "complete",
      creditsCost: 1,
      aspectRatio: "1:1",
      createdAt: 1,
      resultStorageId: result,
      referenceStorageIds: [reference],
    } as Doc<"generations">);

    expect(ids).toEqual(expect.arrayContaining([result, reference]));
    expect(ids).toHaveLength(2);
  });
});
