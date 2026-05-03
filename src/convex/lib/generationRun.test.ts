import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel.js";
import {
  buildGenerationRunRetry,
  buildGenerationRunStageAttemptPatch,
  buildGenerationRunStageSuccess,
  createGenerationRun,
  getGenerationRunAttemptDurationMs,
  getGenerationRunLastProgressAt,
  getGenerationRunStageRetryCount,
  hasGenerationRunStageRetryCapacity,
} from "./generationRun.js";

describe("generation run module", () => {
  it("creates a run in the first stage and records attempt progress against that stage", () => {
    const run = createGenerationRun({
      aspectRatio: "1:1",
      createdAt: 100,
      creditsCost: 1,
      prompt: "editorial mascot",
      referenceStorageIds: ["storage_1" as Id<"_storage">],
      userId: "user_1" as Id<"users">,
    });

    expect(run.status).toBe("generating");
    expect(run.stage).toBe("white_background");
    expect(run.statusMessage).toBe("Creating your image…");
    expect(run.lastProgressAt).toBe(100);
    expect(run.referenceStorageIds).toEqual(["storage_1"]);

    expect(buildGenerationRunStageAttemptPatch(run, "white_background", 140)).toEqual({
      lastProgressAt: 140,
      stageStartedAt: 140,
    });
    expect(buildGenerationRunStageAttemptPatch(run, "black_background", 140)).toBeNull();
  });

  it("advances the run through white and black stage success transitions", () => {
    const whiteSuccess = buildGenerationRunStageSuccess({
      now: 200,
      retryCount: 1,
      stage: "white_background",
      whiteBgStorageId: "white_1" as Id<"_storage">,
    });

    expect(whiteSuccess.nextStage).toBe("black_background");
    expect(whiteSuccess.patch).toEqual({
      lastProgressAt: 200,
      stage: "black_background",
      stageStartedAt: undefined,
      statusMessage: "Enhancing quality…",
      whiteBgRetryCount: 1,
      whiteBgStorageId: "white_1",
    });

    const blackSuccess = buildGenerationRunStageSuccess({
      blackBgStorageId: "black_1" as Id<"_storage">,
      now: 260,
      retryCount: 2,
      stage: "black_background",
    });

    expect(blackSuccess.nextStage).toBe("finalizing");
    expect(blackSuccess.patch).toEqual({
      blackBgRetryCount: 2,
      blackBgStorageId: "black_1",
      lastProgressAt: 260,
      stage: "finalizing",
      stageStartedAt: undefined,
      statusMessage: "Preparing final image…",
    });
  });

  it("owns retry policy, retry instructions, and stage-scoped counters", () => {
    const retry = buildGenerationRunRetry(
      {
        blackBgRetryCount: 0,
        blackBgRetryInstruction: undefined,
        finalizeRetryCount: 0,
        retryCount: 0,
        transparentQa: undefined,
        whiteBgRetryCount: 0,
        whiteBgRetryInstruction: undefined,
      },
      {
        downstreamRetryInstruction: "repair black pass",
        now: 320,
        retryCount: 1,
        retryInstruction: "repair white pass",
        stage: "white_background",
      },
    );

    expect(retry.delayMs).toBe(1500);
    expect(retry.statusMessage).toBe("Refining details…");
    expect(retry.totalRetryCount).toBe(1);
    expect(retry.patch).toEqual({
      blackBgRetryCount: 0,
      blackBgRetryInstruction: "repair black pass",
      finalizeRetryCount: 0,
      lastProgressAt: 320,
      retryCount: 1,
      stage: "white_background",
      stageStartedAt: undefined,
      statusMessage: "Refining details…",
      transparentQa: undefined,
      whiteBgRetryCount: 1,
      whiteBgRetryInstruction: "repair white pass",
    });

    expect(getGenerationRunStageRetryCount(retry.patch, "white_background")).toBe(1);
    expect(hasGenerationRunStageRetryCapacity("white_background", 0)).toBe(true);
    expect(hasGenerationRunStageRetryCapacity("white_background", 1)).toBe(false);
    expect(hasGenerationRunStageRetryCapacity("finalizing", 0)).toBe(true);
    expect(hasGenerationRunStageRetryCapacity("finalizing", 1)).toBe(false);
  });

  it("derives progress timestamps and attempt durations from the run record", () => {
    expect(getGenerationRunLastProgressAt({ createdAt: 10, lastProgressAt: 25 })).toBe(25);
    expect(getGenerationRunLastProgressAt({ createdAt: 10 })).toBe(10);
    expect(
      getGenerationRunAttemptDurationMs(
        { createdAt: 10, lastProgressAt: 20, stageStartedAt: 30 },
        50,
      ),
    ).toBe(20);
  });
});
