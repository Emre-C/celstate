import type { Doc, Id } from "../../_generated/dataModel.js";
import type { Infer } from "convex/values";
import { buildAnimationProductionBrief, type AnimationBrandInputs, type AnimationDestination, type AnimationUseCase } from "./animationPrompts.js";
import { animationGenerationStatusValidator } from "../validation/validators.js";

export type AnimationGenerationStatus = Infer<typeof animationGenerationStatusValidator>;

export const ACTIVE_ANIMATION_GENERATION_STATUSES = [
  "generating_reference",
  "submitting_video",
  "polling_video",
  "reconstructing_alpha",
  "qa",
  "exporting",
] as const satisfies readonly AnimationGenerationStatus[];

export const TERMINAL_ANIMATION_GENERATION_STATUSES = [
  "complete",
  "failed",
] as const satisfies readonly AnimationGenerationStatus[];

export type AnimationGenerationPatch = Partial<
  Omit<Doc<"animationGenerations">, "_creationTime" | "_id">
>;

export type AnimationWorkerJob = Pick<
  Doc<"animationGenerations">,
  | "_creationTime"
  | "_id"
  | "aspectRatio"
  | "brandInputs"
  | "destination"
  | "durationSeconds"
  | "productionBrief"
  | "prompt"
  | "status"
  | "useCase"
> & {
  logoUrl: string | null;
  uploadedReferenceUrls: string[];
};

interface CreateAnimationGenerationRunArgs {
  aspectRatio: string;
  attribution?: Doc<"animationGenerations">["attribution"];
  brandInputs?: AnimationBrandInputs;
  createdAt: number;
  creditsCost: number;
  destination: AnimationDestination;
  durationSeconds: number;
  prompt: string;
  uploadedReferenceStorageIds?: Id<"_storage">[];
  useCase: AnimationUseCase;
  userId: Id<"users">;
}

export function isActiveAnimationGenerationStatus(
  status: AnimationGenerationStatus,
): status is (typeof ACTIVE_ANIMATION_GENERATION_STATUSES)[number] {
  return ACTIVE_ANIMATION_GENERATION_STATUSES.includes(
    status as (typeof ACTIVE_ANIMATION_GENERATION_STATUSES)[number],
  );
}

export function isTerminalAnimationGenerationStatus(
  status: AnimationGenerationStatus,
): status is (typeof TERMINAL_ANIMATION_GENERATION_STATUSES)[number] {
  return TERMINAL_ANIMATION_GENERATION_STATUSES.includes(
    status as (typeof TERMINAL_ANIMATION_GENERATION_STATUSES)[number],
  );
}

export function getAnimationGenerationStatusMessage(
  status: Exclude<AnimationGenerationStatus, "complete" | "failed">,
): string {
  switch (status) {
    case "intake":
      return "Pilot request received.";
    case "queued":
      return "Queued for the animation pilot.";
    case "generating_reference":
      return "Designing the motion asset.";
    case "submitting_video":
      return "Starting animation.";
    case "polling_video":
      return "Animating.";
    case "reconstructing_alpha":
      return "Refining transparency.";
    case "qa":
      return "Checking export quality.";
    case "exporting":
      return "Packaging for OBS and editors.";
  }
}

export function createAnimationGenerationRun(
  args: CreateAnimationGenerationRunArgs,
): Omit<Doc<"animationGenerations">, "_creationTime" | "_id"> {
  const productionBrief = buildAnimationProductionBrief({
    brandInputs: args.brandInputs,
    destination: args.destination,
    durationSeconds: args.durationSeconds,
    prompt: args.prompt,
    useCase: args.useCase,
  });

  return {
    aspectRatio: args.aspectRatio,
    attribution: args.attribution,
    brandInputs: args.brandInputs,
    createdAt: args.createdAt,
    creditsCost: args.creditsCost,
    destination: args.destination,
    durationSeconds: args.durationSeconds,
    lastProgressAt: args.createdAt,
    productionBrief,
    prompt: args.prompt,
    retryCount: 0,
    stageStartedAt: args.createdAt,
    status: "intake",
    statusMessage: getAnimationGenerationStatusMessage("intake"),
    uploadedReferenceStorageIds:
      args.uploadedReferenceStorageIds && args.uploadedReferenceStorageIds.length > 0
        ? args.uploadedReferenceStorageIds
        : undefined,
    useCase: args.useCase,
    userId: args.userId,
  };
}

export function buildAnimationGenerationStagePatch(
  generation: Pick<Doc<"animationGenerations">, "status"> | null,
  expectedStatus: AnimationGenerationStatus,
  status: Exclude<AnimationGenerationStatus, "complete" | "failed">,
  now: number,
  statusMessage?: string,
): AnimationGenerationPatch | null {
  if (
    !generation
    || generation.status !== expectedStatus
    || isTerminalAnimationGenerationStatus(generation.status)
  ) {
    return null;
  }

  return {
    lastProgressAt: now,
    stageStartedAt: now,
    status,
    statusMessage: statusMessage ?? getAnimationGenerationStatusMessage(status),
  };
}

export function buildAnimationGenerationCompletionPatch(args: {
  animationQa?: Doc<"animationGenerations">["animationQa"];
  canonicalFrameManifestStorageId?: Id<"_storage">;
  completedAt: number;
  exports?: Doc<"animationGenerations">["exports"];
  previewStorageId?: Id<"_storage">;
}): AnimationGenerationPatch {
  return {
    animationQa: args.animationQa,
    canonicalFrameManifestStorageId: args.canonicalFrameManifestStorageId,
    completedAt: args.completedAt,
    exports: args.exports,
    lastProgressAt: args.completedAt,
    previewStorageId: args.previewStorageId,
    stageStartedAt: undefined,
    status: "complete",
    statusMessage: undefined,
  };
}

export function buildAnimationGenerationFailurePatch(args: {
  error: string;
  failedAt: number;
}): AnimationGenerationPatch {
  return {
    error: args.error,
    failedAt: args.failedAt,
    lastProgressAt: args.failedAt,
    stageStartedAt: undefined,
    status: "failed",
    statusMessage: undefined,
  };
}
