import type { Doc, Id } from "../../_generated/dataModel.js";
import type { Infer } from "convex/values";
import { lottieGenerationStatusValidator } from "../validation/validators.js";

export type LottieGenerationStatus = Infer<typeof lottieGenerationStatusValidator>;

type LottieGenerationPatch = Partial<Omit<Doc<"lottieGenerations">, "_creationTime" | "_id">>;

export const ACTIVE_LOTTIE_GENERATION_STATUSES = [
  "queued",
  "generating",
  "repairing",
] as const satisfies readonly LottieGenerationStatus[];

export const TERMINAL_LOTTIE_GENERATION_STATUSES = [
  "complete",
  "failed",
] as const satisfies readonly LottieGenerationStatus[];

export function isTerminalLottieGenerationStatus(
  status: LottieGenerationStatus,
): status is (typeof TERMINAL_LOTTIE_GENERATION_STATUSES)[number] {
  return TERMINAL_LOTTIE_GENERATION_STATUSES.includes(
    status as (typeof TERMINAL_LOTTIE_GENERATION_STATUSES)[number],
  );
}

export function getLottieGenerationStatusMessage(
  status: Exclude<LottieGenerationStatus, "complete" | "failed">,
): string {
  switch (status) {
    case "queued":
      return "Queued for Lottie generation.";
    case "generating":
      return "Authoring vector motion JSON.";
    case "repairing":
      return "Repairing the Lottie structure.";
  }
}

export function createLottieGenerationRun(args: {
  aspectRatio: string;
  createdAt: number;
  creditsCost: number;
  durationSeconds: number;
  fps: number;
  grounding?: string;
  prompt: string;
  userId: Id<"users">;
}): Omit<Doc<"lottieGenerations">, "_creationTime" | "_id"> {
  return {
    aspectRatio: args.aspectRatio,
    attemptCount: 0,
    createdAt: args.createdAt,
    creditsCost: args.creditsCost,
    durationSeconds: args.durationSeconds,
    fps: args.fps,
    grounding: args.grounding,
    lastProgressAt: args.createdAt,
    prompt: args.prompt,
    status: "queued",
    statusMessage: getLottieGenerationStatusMessage("queued"),
    userId: args.userId,
  };
}

export function buildLottieGenerationAttemptPatch(
  generation: Pick<Doc<"lottieGenerations">, "status"> | null,
  args: {
    attemptCount: number;
    expectedStatus: LottieGenerationStatus;
    now: number;
    status: Exclude<LottieGenerationStatus, "queued" | "complete" | "failed">;
    statusMessage?: string;
    validation?: Doc<"lottieGenerations">["validation"];
  },
): LottieGenerationPatch | null {
  if (
    !generation
    || generation.status !== args.expectedStatus
    || isTerminalLottieGenerationStatus(generation.status)
  ) {
    return null;
  }

  return {
    attemptCount: args.attemptCount,
    lastProgressAt: args.now,
    status: args.status,
    statusMessage: args.statusMessage ?? getLottieGenerationStatusMessage(args.status),
    validation: args.validation,
  };
}

export function buildLottieGenerationCompletionPatch(args: {
  completedAt: number;
  lottieStorageId: Id<"_storage">;
  validation: Doc<"lottieGenerations">["validation"];
}): LottieGenerationPatch {
  return {
    completedAt: args.completedAt,
    lastProgressAt: args.completedAt,
    lottieStorageId: args.lottieStorageId,
    status: "complete",
    statusMessage: undefined,
    validation: args.validation,
  };
}

export function buildLottieGenerationFailurePatch(args: {
  error: string;
  failedAt: number;
  validation?: Doc<"lottieGenerations">["validation"];
}): LottieGenerationPatch {
  return {
    error: args.error,
    failedAt: args.failedAt,
    lastProgressAt: args.failedAt,
    status: "failed",
    statusMessage: undefined,
    validation: args.validation,
  };
}
