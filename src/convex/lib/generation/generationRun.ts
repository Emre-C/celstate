import type { Doc, Id } from "../../_generated/dataModel.js";
import type { Infer } from "convex/values";
import { GENERATION_CONFIG } from "../config.js";
import { generationStageValidator } from "../validation/validators.js";

export type GenerationStage = Infer<typeof generationStageValidator>;

type GenerationRunPatch = Partial<Omit<Doc<"generations">, "_id" | "_creationTime">>;

type GenerationProgressRecord = Pick<Doc<"generations">, "createdAt" | "lastProgressAt" | "stageStartedAt">;

type GenerationRetryRecord = Pick<
  Doc<"generations">,
  | "blackBgRetryCount"
  | "blackBgRetryInstruction"
  | "finalizeRetryCount"
  | "retryCount"
  | "transparentQa"
  | "whiteBgRetryCount"
  | "whiteBgRetryInstruction"
>;

type GenerationRunnableRecord = Pick<Doc<"generations">, "stage" | "status">;

interface CreateGenerationRunArgs {
  aspectRatio: string;
  createdAt: number;
  creditsCost: number;
  prompt: string;
  referenceStorageIds: Id<"_storage">[];
  userId: Id<"users">;
}

type GenerationStageSuccessArgs =
  | {
      now: number;
      retryCount: number;
      stage: "white_background";
      whiteBgStorageId: Id<"_storage">;
    }
  | {
      blackBgStorageId: Id<"_storage">;
      now: number;
      retryCount: number;
      stage: "black_background";
    };

interface GenerationRetryArgs {
  downstreamRetryInstruction?: string;
  now: number;
  retryCount: number;
  retryInstruction?: string;
  stage: GenerationStage;
  transparentQa?: Doc<"generations">["transparentQa"];
}

interface GenerationCompletionArgs {
  blackBgStorageId?: Id<"_storage">;
  completedAt: number;
  dimensionMismatch: boolean;
  generationTimeMs: number;
  optimizedStorageId?: Id<"_storage">;
  resultStorageId: Id<"_storage">;
  retryCount: number;
  transparentQa: Doc<"generations">["transparentQa"];
  whiteBgStorageId?: Id<"_storage">;
}

interface GenerationFailureArgs {
  completedAt: number;
  error: string;
  failureKind?: Doc<"generations">["failureKind"];
  failureStage?: Doc<"generations">["failureStage"];
  transparentQa?: Doc<"generations">["transparentQa"];
}

export function getGenerationRunStageStatusMessage(stage: GenerationStage): string {
  switch (stage) {
    case "white_background":
      return "Creating your image…";
    case "black_background":
      return "Enhancing quality…";
    case "finalizing":
      return "Preparing final image…";
  }
}

export function getGenerationRunRetryStatusMessage(stage: GenerationStage, retryCount: number): string {
  switch (stage) {
    case "white_background":
      return retryCount > 0 ? "Refining details…" : getGenerationRunStageStatusMessage(stage);
    case "black_background":
      return retryCount > 0 ? "Fine-tuning output…" : getGenerationRunStageStatusMessage(stage);
    case "finalizing":
      return retryCount > 0
        ? `Still working on it (attempt ${retryCount + 1})…`
        : getGenerationRunStageStatusMessage(stage);
  }
}

export function getGenerationRunRetryDelayMs(retryAttemptIndex: number): number {
  return GENERATION_CONFIG.retryBaseDelayMs * Math.pow(2, retryAttemptIndex);
}

export function getGenerationRunLastProgressAt(record: Pick<GenerationProgressRecord, "createdAt" | "lastProgressAt">): number {
  return record.lastProgressAt ?? record.createdAt;
}

export function getGenerationRunDurationMs(record: Pick<GenerationProgressRecord, "createdAt">, now: number): number {
  return Math.max(0, now - record.createdAt);
}

export function getGenerationRunAttemptDurationMs(record: GenerationProgressRecord, now: number): number {
  return Math.max(
    0,
    now - (record.stageStartedAt ?? record.lastProgressAt ?? record.createdAt),
  );
}

export function getGenerationRunStageRetryCount(
  generation: Pick<GenerationRetryRecord, "blackBgRetryCount" | "finalizeRetryCount" | "whiteBgRetryCount">,
  stage: GenerationStage,
): number {
  switch (stage) {
    case "white_background":
      return generation.whiteBgRetryCount ?? 0;
    case "black_background":
      return generation.blackBgRetryCount ?? 0;
    case "finalizing":
      return generation.finalizeRetryCount ?? 0;
  }
}

export function hasGenerationRunStageRetryCapacity(stage: GenerationStage, retryCount: number): boolean {
  if (stage === "finalizing") {
    return retryCount < GENERATION_CONFIG.maxFinalizeRetries;
  }

  return retryCount < GENERATION_CONFIG.maxRetriesPerPass;
}

export function isGenerationRunStageRunnable<
  TGeneration extends GenerationRunnableRecord,
  TStage extends GenerationStage,
>(
  generation: TGeneration | null,
  stage: TStage,
): generation is TGeneration & { stage: TStage; status: "generating" } {
  return !!generation && generation.status === "generating" && generation.stage === stage;
}

/**
 * Stage-aware compare-and-set guard.
 *
 * Returns true only when the run is still actively generating AND its current
 * stage matches the expected one. Use this at every mutation boundary that
 * applies a stage-specific patch (success, retry, completion) so a stale
 * scheduler/internal-action replay cannot advance or rewind a run that has
 * already moved on, been failed, or completed.
 */
export function isGenerationRunInStage<
  TGeneration extends GenerationRunnableRecord,
  TStage extends GenerationStage,
>(
  generation: TGeneration | null,
  stage: TStage,
): generation is TGeneration & { stage: TStage; status: "generating" } {
  return isGenerationRunStageRunnable(generation, stage);
}

/**
 * Returns true only when the run is currently in the "generating" status.
 * Failure paths can transition from any stage, so they only require liveness.
 */
export function isGenerationRunInFlight<TGeneration extends GenerationRunnableRecord>(
  generation: TGeneration | null,
): generation is TGeneration & { status: "generating" } {
  return !!generation && generation.status === "generating";
}

export function createGenerationRun(args: CreateGenerationRunArgs) {
  return {
    aspectRatio: args.aspectRatio,
    blackBgRetryCount: 0,
    createdAt: args.createdAt,
    creditsCost: args.creditsCost,
    finalizeRetryCount: 0,
    lastProgressAt: args.createdAt,
    prompt: args.prompt,
    referenceStorageIds: args.referenceStorageIds.length > 0 ? args.referenceStorageIds : undefined,
    retryCount: 0,
    stage: "white_background" as const,
    status: "generating" as const,
    statusMessage: getGenerationRunStageStatusMessage("white_background"),
    userId: args.userId,
    whiteBgRetryCount: 0,
  } satisfies Omit<Doc<"generations">, "_creationTime" | "_id">;
}

export function buildGenerationRunStageAttemptPatch(
  generation: GenerationRunnableRecord | null,
  stage: GenerationStage,
  now: number,
): GenerationRunPatch | null {
  if (!isGenerationRunStageRunnable(generation, stage)) {
    return null;
  }

  return {
    lastProgressAt: now,
    stageStartedAt: now,
  };
}

export function buildGenerationRunStageSuccess(
  args: GenerationStageSuccessArgs,
): { nextStage: Exclude<GenerationStage, "white_background">; patch: GenerationRunPatch } {
  switch (args.stage) {
    case "white_background":
      return {
        nextStage: "black_background",
        patch: {
          lastProgressAt: args.now,
          stage: "black_background",
          stageStartedAt: undefined,
          statusMessage: getGenerationRunStageStatusMessage("black_background"),
          whiteBgRetryCount: args.retryCount,
          whiteBgStorageId: args.whiteBgStorageId,
        },
      };
    case "black_background":
      return {
        nextStage: "finalizing",
        patch: {
          blackBgRetryCount: args.retryCount,
          blackBgStorageId: args.blackBgStorageId,
          lastProgressAt: args.now,
          stage: "finalizing",
          stageStartedAt: undefined,
          statusMessage: getGenerationRunStageStatusMessage("finalizing"),
        },
      };
  }
}

export function buildGenerationRunRetry(
  generation: GenerationRetryRecord,
  args: GenerationRetryArgs,
): {
  delayMs: number;
  patch: GenerationRunPatch;
  statusMessage: string;
  totalRetryCount: number;
} {
  const totalRetryCount = (generation.retryCount ?? 0) + 1;
  const statusMessage = getGenerationRunRetryStatusMessage(args.stage, args.retryCount);

  return {
    delayMs: getGenerationRunRetryDelayMs(Math.max(args.retryCount - 1, 0)),
    statusMessage,
    totalRetryCount,
    patch: {
      blackBgRetryCount:
        args.stage === "black_background"
          ? args.retryCount
          : generation.blackBgRetryCount,
      blackBgRetryInstruction:
        args.stage === "black_background"
          ? args.retryInstruction
          : args.stage === "white_background"
            ? args.downstreamRetryInstruction
            : generation.blackBgRetryInstruction,
      finalizeRetryCount:
        args.stage === "finalizing"
          ? args.retryCount
          : generation.finalizeRetryCount,
      lastProgressAt: args.now,
      retryCount: totalRetryCount,
      stage: args.stage,
      stageStartedAt: undefined,
      statusMessage,
      transparentQa: args.transparentQa,
      whiteBgRetryCount:
        args.stage === "white_background"
          ? args.retryCount
          : generation.whiteBgRetryCount,
      whiteBgRetryInstruction:
        args.stage === "white_background"
          ? args.retryInstruction
          : generation.whiteBgRetryInstruction,
    },
  };
}

export function buildGenerationRunCompletionPatch(args: GenerationCompletionArgs): GenerationRunPatch {
  return {
    blackBgStorageId: args.blackBgStorageId,
    completedAt: args.completedAt,
    dimensionMismatch: args.dimensionMismatch,
    generationTimeMs: args.generationTimeMs,
    lastProgressAt: args.completedAt,
    optimizedStorageId: args.optimizedStorageId,
    resultStorageId: args.resultStorageId,
    retryCount: args.retryCount,
    stage: undefined,
    stageStartedAt: undefined,
    status: "complete",
    statusMessage: undefined,
    transparentQa: args.transparentQa,
    whiteBgStorageId: args.whiteBgStorageId,
  };
}

export function buildGenerationRunFailurePatch(args: GenerationFailureArgs): GenerationRunPatch {
  return {
    completedAt: args.completedAt,
    error: args.error,
    failureKind: args.failureKind,
    failureStage: args.failureStage,
    lastProgressAt: args.completedAt,
    stage: undefined,
    stageStartedAt: undefined,
    status: "failed",
    statusMessage: undefined,
    transparentQa: args.transparentQa,
  };
}

export function buildGenerationRunStatusPatch(statusMessage: string, now: number): GenerationRunPatch {
  return {
    lastProgressAt: now,
    stalledAlertedAt: undefined,
    statusMessage,
  };
}
