import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel.js";
import {
  buildLottieGenerationAttemptPatch,
  buildLottieGenerationCompletionPatch,
  buildLottieGenerationFailurePatch,
  createLottieGenerationRun,
  getLottieGenerationStatusMessage,
} from "./lottieGenerationRun.js";

describe("lottieGenerationRun", () => {
  it("creates a queued run with zero attempts", () => {
    const run = createLottieGenerationRun({
      aspectRatio: "1:1",
      createdAt: 100,
      creditsCost: 0,
      durationSeconds: 4,
      fps: 60,
      prompt: "draw a leaf",
      userId: "u1" as Id<"users">,
    });

    expect(run.status).toBe("queued");
    expect(run.attemptCount).toBe(0);
    expect(run.statusMessage).toBe(getLottieGenerationStatusMessage("queued"));
  });

  it("guards attempt patches by expected status", () => {
    expect(
      buildLottieGenerationAttemptPatch(
        { status: "queued" },
        {
          attemptCount: 1,
          expectedStatus: "queued",
          now: 200,
          status: "generating",
        },
      ),
    ).toEqual({
      attemptCount: 1,
      lastProgressAt: 200,
      status: "generating",
      statusMessage: "Authoring vector motion JSON.",
      validation: undefined,
    });

    expect(
      buildLottieGenerationAttemptPatch(
        { status: "complete" },
        {
          attemptCount: 2,
          expectedStatus: "generating",
          now: 200,
          status: "repairing",
        },
      ),
    ).toBeNull();
  });

  it("builds terminal patches", () => {
    const validation = {
      decision: "pass" as const,
      errors: [],
      warnings: [],
      version: "lottie-v1",
    };

    expect(buildLottieGenerationCompletionPatch({
      completedAt: 300,
      lottieStorageId: "s1" as Id<"_storage">,
      validation,
    })).toEqual({
      completedAt: 300,
      lastProgressAt: 300,
      lottieStorageId: "s1",
      status: "complete",
      statusMessage: undefined,
      validation,
    });

    expect(buildLottieGenerationFailurePatch({
      error: "bad json",
      failedAt: 400,
    })).toMatchObject({
      error: "bad json",
      failedAt: 400,
      status: "failed",
    });
  });
});
