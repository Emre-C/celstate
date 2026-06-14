import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel.js";
import { GENERATION_CONFIG } from "./config.js";
import {
  assertRetentionBoundedCutoff,
  computeExpiredArtifactCutoff,
  isAnimationGenerationEligibleForRetentionPurge,
  isGenerationEligibleForRetentionPurge,
  storageIdsFromAnimationGeneration,
  storageIdsFromGeneration,
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

  it("only terminal animations older than cutoff are retention-eligible", () => {
    const cutoff = 1_000;
    const base = {
      _id: "a1" as Id<"animationGenerations">,
      _creationTime: 0,
      userId: "u1" as Id<"users">,
      prompt: "p",
      useCase: "small_accent" as const,
      destination: "web_runtime" as const,
      aspectRatio: "1:1",
      durationSeconds: 4,
      creditsCost: 1,
      retryCount: 0,
      createdAt: 500,
    } satisfies Partial<Doc<"animationGenerations">>;

    expect(
      isAnimationGenerationEligibleForRetentionPurge(
        { ...base, status: "failed" } as Doc<"animationGenerations">,
        cutoff,
      ),
    ).toBe(true);
    expect(
      isAnimationGenerationEligibleForRetentionPurge(
        { ...base, status: "exporting" } as Doc<"animationGenerations">,
        cutoff,
      ),
    ).toBe(false);
  });

  it("dedupes duplicate animation export storage ids", () => {
    const shared = "kg_shared" as Id<"_storage">;
    const ids = storageIdsFromAnimationGeneration({
      _id: "a1" as Id<"animationGenerations">,
      _creationTime: 0,
      userId: "u1" as Id<"users">,
      prompt: "p",
      useCase: "small_accent",
      destination: "web_runtime",
      status: "complete",
      aspectRatio: "1:1",
      durationSeconds: 4,
      creditsCost: 1,
      retryCount: 0,
      createdAt: 1,
      canonicalFrameManifestStorageId: shared,
      previewStorageId: shared,
      exports: {
        runtimeManifestStorageId: shared,
        apngStorageId: shared,
      },
    } as Doc<"animationGenerations">);

    expect(ids).toEqual([shared]);
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
