import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { getCurrentAppUser, upsertCurrentUser, applyCreditsToUser } from "./users.js";
import {
  ANIMATION_GENERATION_CONFIG,
  isValidAnimationAspectRatio,
  isValidAnimationDurationSeconds,
} from "./lib/config.js";
import {
  ACTIVE_ANIMATION_GENERATION_STATUSES,
  buildAnimationGenerationCompletionPatch,
  buildAnimationGenerationFailurePatch,
  buildAnimationGenerationRequeuePatch,
  buildAnimationGenerationStagePatch,
  getAnimationGenerationStatusMessage,
  createAnimationGenerationRun,
  isTerminalAnimationGenerationStatus,
  type AnimationGenerationStatus,
  type AnimationWorkerJob,
} from "./lib/animation/animationGenerationRun.js";
import {
  animationAttributionValidator,
  animationBrandInputsValidator,
  animationDestinationValidator,
  animationExportsValidator,
  animationGenerationStatusValidator,
  animationPublicBrandInputsValidator,
  animationQaValidator,
  animationUseCaseValidator,
} from "./lib/validation/validators.js";
import type { AnimationBrandInputs } from "./lib/animation/animationPrompts.js";
import { validateReferenceImageMetadata } from "./lib/validation/validation.js";

const animationExportUrlsValidator = v.object({
  apngUrl: v.union(v.string(), v.null()),
  pngSequenceUrl: v.union(v.string(), v.null()),
  runtimeManifestUrl: v.union(v.string(), v.null()),
  spriteSheetUrl: v.union(v.string(), v.null()),
  webpSpriteSheetUrl: v.union(v.string(), v.null()),
});

const animationGenerationWithUrlsValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("animationGenerations"),
  animationQa: v.optional(animationQaValidator),
  aspectRatio: v.string(),
  attribution: v.optional(animationAttributionValidator),
  brandInputs: v.optional(animationBrandInputsValidator),
  canonicalFrameManifestStorageId: v.optional(v.id("_storage")),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  creditRefundedAt: v.optional(v.number()),
  creditsCost: v.number(),
  destination: animationDestinationValidator,
  durationSeconds: v.number(),
  error: v.optional(v.string()),
  exportUrls: animationExportUrlsValidator,
  exports: v.optional(animationExportsValidator),
  failedAt: v.optional(v.number()),
  lastProgressAt: v.optional(v.number()),
  previewStorageId: v.optional(v.id("_storage")),
  previewUrl: v.union(v.string(), v.null()),
  productionBrief: v.optional(v.string()),
  prompt: v.string(),
  referenceGenerationId: v.optional(v.id("generations")),
  retryCount: v.number(),
  stageStartedAt: v.optional(v.number()),
  status: animationGenerationStatusValidator,
  statusMessage: v.optional(v.string()),
  uploadedReferenceStorageIds: v.optional(v.array(v.id("_storage"))),
  useCase: animationUseCaseValidator,
  userId: v.id("users"),
});

const animationWorkerJobValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("animationGenerations"),
  aspectRatio: v.string(),
  brandInputs: v.optional(animationBrandInputsValidator),
  destination: animationDestinationValidator,
  durationSeconds: v.number(),
  logoUrl: v.union(v.string(), v.null()),
  productionBrief: v.optional(v.string()),
  prompt: v.string(),
  status: animationGenerationStatusValidator,
  uploadedReferenceUrls: v.array(v.string()),
  useCase: animationUseCaseValidator,
});

type AnimationGenerationWithUrls = Doc<"animationGenerations"> & {
  exportUrls: {
    apngUrl: string | null;
    pngSequenceUrl: string | null;
    runtimeManifestUrl: string | null;
    spriteSheetUrl: string | null;
    webpSpriteSheetUrl: string | null;
  };
  previewUrl: string | null;
};

function assertAnimationWorkerSecret(workerSecret: string): void {
  const expected = process.env.ANIMATION_WORKER_SECRET?.trim();
  if (!expected) {
    throw new ConvexError("Animation worker secret is not configured");
  }
  if (workerSecret !== expected) {
    throw new ConvexError("Invalid animation worker secret");
  }
}

function normalizeOptionalString(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, maxLength);
}

function normalizeBrandColors(colors: string[] | undefined): string[] | undefined {
  if (!colors) {
    return undefined;
  }

  const normalized = colors
    .map((color) => normalizeOptionalString(color, 40))
    .filter((color): color is string => color !== undefined)
    .slice(0, ANIMATION_GENERATION_CONFIG.maxBrandColors);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBrandInputs(
  brandInputs: {
    channelName?: string;
    colors?: string[];
    creatorHandle?: string;
    logoStorageId?: Id<"_storage">;
  } | undefined,
): AnimationBrandInputs | undefined {
  if (!brandInputs) {
    return undefined;
  }

  const normalized = {
    channelName: normalizeOptionalString(
      brandInputs.channelName,
      ANIMATION_GENERATION_CONFIG.maxBrandInputLength,
    ),
    colors: normalizeBrandColors(brandInputs.colors),
    creatorHandle: normalizeOptionalString(
      brandInputs.creatorHandle,
      ANIMATION_GENERATION_CONFIG.maxBrandInputLength,
    ),
    logoStorageId: brandInputs.logoStorageId,
  };

  return normalized.channelName
    || normalized.colors
    || normalized.creatorHandle
    || normalized.logoStorageId
    ? normalized
    : undefined;
}

function normalizeAttribution(
  attribution: Doc<"animationGenerations">["attribution"] | undefined,
): Doc<"animationGenerations">["attribution"] | undefined {
  if (!attribution) {
    return undefined;
  }

  const normalized = {
    campaignId: normalizeOptionalString(
      attribution.campaignId,
      ANIMATION_GENERATION_CONFIG.maxAttributionValueLength,
    ),
    creatorCode: normalizeOptionalString(
      attribution.creatorCode,
      ANIMATION_GENERATION_CONFIG.maxAttributionValueLength,
    ),
    landingPageVariant: normalizeOptionalString(
      attribution.landingPageVariant,
      ANIMATION_GENERATION_CONFIG.maxAttributionValueLength,
    ),
    source: attribution.source,
  };

  return normalized.campaignId
    || normalized.creatorCode
    || normalized.landingPageVariant
    || normalized.source
    ? normalized
    : undefined;
}

async function countActiveAnimationGenerations(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
): Promise<number> {
  let count = 0;
  for (const status of ACTIVE_ANIMATION_GENERATION_STATUSES) {
    const rows = await ctx.db
      .query("animationGenerations")
      .withIndex("by_user_status_created", (q) =>
        q.eq("userId", userId).eq("status", status)
      )
      .take(ANIMATION_GENERATION_CONFIG.maxActiveAnimationGenerations);
    count += rows.length;
    if (count >= ANIMATION_GENERATION_CONFIG.maxActiveAnimationGenerations) {
      return count;
    }
  }
  return count;
}

async function countRecentAnimationRequests(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  now: number,
): Promise<number> {
  return (
    await ctx.db
      .query("animationGenerations")
      .withIndex("by_user_created", (q) =>
        q
          .eq("userId", userId)
          .gte("createdAt", now - ANIMATION_GENERATION_CONFIG.requestWindowMs)
      )
      .take(ANIMATION_GENERATION_CONFIG.maxRequestsPerWindow)
  ).length;
}

async function validateAnimationStorageId(
  ctx: Pick<MutationCtx, "db">,
  storageId: Id<"_storage">,
  label: string,
): Promise<void> {
  const validation = validateReferenceImageMetadata(
    await ctx.db.system.get("_storage", storageId),
  );
  if (!validation.valid) {
    throw new ConvexError(`${label}: ${validation.reason ?? "Invalid image reference"}`);
  }
}

async function validateAnimationStorageInputs(
  ctx: Pick<MutationCtx, "db">,
  args: {
    brandInputs?: AnimationBrandInputs;
    uploadedReferenceStorageIds?: Id<"_storage">[];
  },
): Promise<void> {
  const uploadedReferenceStorageIds = args.uploadedReferenceStorageIds ?? [];
  if (uploadedReferenceStorageIds.length > ANIMATION_GENERATION_CONFIG.maxReferenceImages) {
    throw new ConvexError(
      `Maximum ${ANIMATION_GENERATION_CONFIG.maxReferenceImages} animation reference images allowed`,
    );
  }

  const seen = new Set<string>();
  for (const storageId of uploadedReferenceStorageIds) {
    const key = String(storageId);
    if (seen.has(key)) {
      throw new ConvexError("Duplicate animation reference images are not allowed");
    }
    seen.add(key);
    await validateAnimationStorageId(ctx, storageId, "Animation reference image");
  }

  if (args.brandInputs?.logoStorageId) {
    await validateAnimationStorageId(ctx, args.brandInputs.logoStorageId, "Logo reference image");
  }
}

async function resolveStorageUrl(
  ctx: Pick<QueryCtx, "storage">,
  storageId: Id<"_storage"> | undefined,
): Promise<string | null> {
  return storageId ? await ctx.storage.getUrl(storageId) : null;
}

async function resolveAnimationGenerationWithUrls(
  ctx: Pick<QueryCtx, "storage">,
  generation: Doc<"animationGenerations">,
): Promise<AnimationGenerationWithUrls> {
  const exports = generation.exports;
  const [
    previewUrl,
    pngSequenceUrl,
    apngUrl,
    runtimeManifestUrl,
    spriteSheetUrl,
    webpSpriteSheetUrl,
  ] = await Promise.all([
    resolveStorageUrl(ctx, generation.previewStorageId),
    resolveStorageUrl(ctx, exports?.pngSequenceStorageId),
    resolveStorageUrl(ctx, exports?.apngStorageId),
    resolveStorageUrl(ctx, exports?.runtimeManifestStorageId),
    resolveStorageUrl(ctx, exports?.spriteSheetStorageId),
    resolveStorageUrl(ctx, exports?.webpSpriteSheetStorageId),
  ]);

  return {
    ...generation,
    exportUrls: {
      apngUrl,
      pngSequenceUrl,
      runtimeManifestUrl,
      spriteSheetUrl,
      webpSpriteSheetUrl,
    },
    previewUrl,
  };
}

async function resolveStorageUrls(
  ctx: Pick<QueryCtx, "storage">,
  storageIds: Id<"_storage">[] | undefined,
): Promise<string[]> {
  if (!storageIds || storageIds.length === 0) {
    return [];
  }

  const urls = await Promise.all(storageIds.map((storageId) => ctx.storage.getUrl(storageId)));
  return urls.filter((url): url is string => url !== null);
}

async function resolveAnimationWorkerJob(
  ctx: Pick<QueryCtx, "storage">,
  generation: Doc<"animationGenerations">,
): Promise<AnimationWorkerJob> {
  return {
    _creationTime: generation._creationTime,
    _id: generation._id,
    aspectRatio: generation.aspectRatio,
    brandInputs: generation.brandInputs,
    destination: generation.destination,
    durationSeconds: generation.durationSeconds,
    logoUrl: await resolveStorageUrl(ctx, generation.brandInputs?.logoStorageId),
    productionBrief: generation.productionBrief,
    prompt: generation.prompt,
    status: generation.status,
    uploadedReferenceUrls: await resolveStorageUrls(ctx, generation.uploadedReferenceStorageIds),
    useCase: generation.useCase,
  };
}

async function requestAnimationGenerationCore(
  ctx: MutationCtx,
  args: {
    aspectRatio: string;
    attribution?: Doc<"animationGenerations">["attribution"];
    brandInputs?: AnimationBrandInputs;
    destination: Doc<"animationGenerations">["destination"];
    durationSeconds: number;
    prompt: string;
    uploadedReferenceStorageIds?: Id<"_storage">[];
    useCase: Doc<"animationGenerations">["useCase"];
    userId: Id<"users">;
  },
): Promise<Id<"animationGenerations">> {
  const user = await ctx.db.get(args.userId);
  if (!user) {
    throw new ConvexError("User not found");
  }

  const activeCount = await countActiveAnimationGenerations(ctx, args.userId);
  if (activeCount >= ANIMATION_GENERATION_CONFIG.maxActiveAnimationGenerations) {
    throw new ConvexError("Too many animation requests in progress. Please wait for one to finish.");
  }

  const now = Date.now();
  const recentCount = await countRecentAnimationRequests(ctx, args.userId, now);
  if (recentCount >= ANIMATION_GENERATION_CONFIG.maxRequestsPerWindow) {
    throw new ConvexError("Too many animation requests submitted recently. Please wait and try again.");
  }

  await validateAnimationStorageInputs(ctx, {
    brandInputs: args.brandInputs,
    uploadedReferenceStorageIds: args.uploadedReferenceStorageIds,
  });

  const creditsCost = ANIMATION_GENERATION_CONFIG.creditsPerAnimationRequest;
  if (creditsCost > 0 && (user.credits ?? 0) < creditsCost) {
    throw new ConvexError("Insufficient credits");
  }
  if (creditsCost > 0) {
    await ctx.db.patch(args.userId, {
      credits: (user.credits ?? 0) - creditsCost,
    });
  }

  const run = createAnimationGenerationRun({
    aspectRatio: args.aspectRatio,
    attribution: normalizeAttribution(args.attribution),
    brandInputs: args.brandInputs,
    createdAt: now,
    creditsCost,
    destination: args.destination,
    durationSeconds: args.durationSeconds,
    prompt: args.prompt,
    uploadedReferenceStorageIds: args.uploadedReferenceStorageIds,
    useCase: args.useCase,
    userId: args.userId,
  });

  return await ctx.db.insert("animationGenerations", run);
}

function validateAnimationRequestInput(args: {
  aspectRatio?: string;
  durationSeconds?: number;
  prompt: string;
}): {
  aspectRatio: string;
  durationSeconds: number;
  prompt: string;
} {
  const prompt = args.prompt.trim();
  if (!prompt) {
    throw new ConvexError("Prompt is required");
  }
  if (prompt.length > ANIMATION_GENERATION_CONFIG.maxPromptLength) {
    throw new ConvexError(
      `Prompt too long (max ${ANIMATION_GENERATION_CONFIG.maxPromptLength} characters)`,
    );
  }

  const aspectRatio = args.aspectRatio ?? ANIMATION_GENERATION_CONFIG.defaultAspectRatio;
  if (!isValidAnimationAspectRatio(aspectRatio)) {
    throw new ConvexError(`Unsupported animation aspect ratio: ${aspectRatio}`);
  }

  const durationSeconds =
    args.durationSeconds ?? ANIMATION_GENERATION_CONFIG.defaultDurationSeconds;
  if (!isValidAnimationDurationSeconds(durationSeconds)) {
    throw new ConvexError(`Unsupported animation duration: ${durationSeconds}`);
  }

  return { aspectRatio, durationSeconds, prompt };
}

export const requestAnimationGeneration = mutation({
  args: {
    aspectRatio: v.optional(v.string()),
    attribution: v.optional(animationAttributionValidator),
    brandInputs: v.optional(animationPublicBrandInputsValidator),
    destination: animationDestinationValidator,
    durationSeconds: v.optional(v.number()),
    prompt: v.string(),
    useCase: animationUseCaseValidator,
  },
  returns: v.id("animationGenerations"),
  handler: async (ctx, args) => {
    const appUser = await upsertCurrentUser(ctx);
    const input = validateAnimationRequestInput(args);

    return await requestAnimationGenerationCore(ctx, {
      ...input,
      attribution: normalizeAttribution(args.attribution),
      brandInputs: normalizeBrandInputs(args.brandInputs),
      destination: args.destination,
      useCase: args.useCase,
      userId: appUser._id,
    });
  },
});

export const requestAnimationGenerationForUser = internalMutation({
  args: {
    aspectRatio: v.optional(v.string()),
    attribution: v.optional(animationAttributionValidator),
    brandInputs: v.optional(animationBrandInputsValidator),
    destination: animationDestinationValidator,
    durationSeconds: v.optional(v.number()),
    prompt: v.string(),
    uploadedReferenceStorageIds: v.optional(v.array(v.id("_storage"))),
    useCase: animationUseCaseValidator,
    userId: v.id("users"),
  },
  returns: v.id("animationGenerations"),
  handler: async (ctx, args) => {
    const input = validateAnimationRequestInput(args);

    return await requestAnimationGenerationCore(ctx, {
      ...input,
      attribution: normalizeAttribution(args.attribution),
      brandInputs: normalizeBrandInputs(args.brandInputs),
      destination: args.destination,
      uploadedReferenceStorageIds: args.uploadedReferenceStorageIds,
      useCase: args.useCase,
      userId: args.userId,
    });
  },
});

export const getByUserWithUrls = query({
  args: {},
  returns: v.array(animationGenerationWithUrlsValidator),
  handler: async (ctx) => {
    const appUser = await getCurrentAppUser(ctx);
    if (!appUser) {
      return [];
    }

    const generations = await ctx.db
      .query("animationGenerations")
      .withIndex("by_user_created", (q) => q.eq("userId", appUser._id))
      .order("desc")
      .take(50);

    return Promise.all(
      generations.map((generation) => resolveAnimationGenerationWithUrls(ctx, generation)),
    );
  },
});

export const getByUserAndIdWithUrls = query({
  args: {
    animationGenerationId: v.string(),
  },
  returns: v.union(animationGenerationWithUrlsValidator, v.null()),
  handler: async (ctx, args) => {
    const appUser = await getCurrentAppUser(ctx);
    if (!appUser) {
      return null;
    }

    const animationGenerationId = ctx.db.normalizeId(
      "animationGenerations",
      args.animationGenerationId,
    );
    if (!animationGenerationId) {
      return null;
    }

    const generation = await ctx.db.get(animationGenerationId);
    if (!generation || generation.userId !== appUser._id) {
      return null;
    }

    return resolveAnimationGenerationWithUrls(ctx, generation);
  },
});

export const getById = internalQuery({
  args: {
    animationGenerationId: v.id("animationGenerations"),
  },
  returns: v.union(animationGenerationWithUrlsValidator, v.null()),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.animationGenerationId);
    if (!generation) {
      return null;
    }
    return resolveAnimationGenerationWithUrls(ctx, generation);
  },
});

export const markStage = internalMutation({
  args: {
    animationGenerationId: v.id("animationGenerations"),
    expectedStatus: animationGenerationStatusValidator,
    status: animationGenerationStatusValidator,
    statusMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.status === "complete" || args.status === "failed") {
      throw new ConvexError("Use completeAnimationGeneration or failAnimationGeneration for terminal statuses");
    }

    const generation = await ctx.db.get(args.animationGenerationId);
    const patch = buildAnimationGenerationStagePatch(
      generation,
      args.expectedStatus,
      args.status as Exclude<AnimationGenerationStatus, "complete" | "failed">,
      Date.now(),
      args.statusMessage,
    );
    if (!patch) {
      return null;
    }

    await ctx.db.patch(args.animationGenerationId, patch);
    return null;
  },
});

export const completeAnimationGeneration = internalMutation({
  args: {
    animationGenerationId: v.id("animationGenerations"),
    animationQa: v.optional(animationQaValidator),
    canonicalFrameManifestStorageId: v.optional(v.id("_storage")),
    expectedStatus: animationGenerationStatusValidator,
    exports: v.optional(animationExportsValidator),
    previewStorageId: v.optional(v.id("_storage")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.animationGenerationId);
    if (
      !generation
      || generation.status !== args.expectedStatus
      || isTerminalAnimationGenerationStatus(generation.status)
    ) {
      return null;
    }
    if (args.animationQa?.decision !== "pass") {
      throw new ConvexError("Completion requires passing animation QA");
    }
    if (!args.canonicalFrameManifestStorageId) {
      throw new ConvexError("Completion requires a canonical frame manifest");
    }
    if (!args.previewStorageId) {
      throw new ConvexError("Completion requires a preview asset");
    }
    if (
      !args.exports
      || !(
        args.exports.pngSequenceStorageId
        || args.exports.apngStorageId
        || args.exports.runtimeManifestStorageId
        || args.exports.spriteSheetStorageId
        || args.exports.webpSpriteSheetStorageId
      )
    ) {
      throw new ConvexError("Completion requires at least one transparent export");
    }

    await ctx.db.patch(args.animationGenerationId, buildAnimationGenerationCompletionPatch({
      animationQa: args.animationQa,
      canonicalFrameManifestStorageId: args.canonicalFrameManifestStorageId,
      completedAt: Date.now(),
      exports: args.exports,
      previewStorageId: args.previewStorageId,
    }));
    return null;
  },
});

export const failAnimationGeneration = internalMutation({
  args: {
    animationGenerationId: v.id("animationGenerations"),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.animationGenerationId);
    if (!generation || isTerminalAnimationGenerationStatus(generation.status)) {
      return null;
    }

    const failedAt = Date.now();
    await ctx.db.patch(args.animationGenerationId, buildAnimationGenerationFailurePatch({
      error: args.error,
      failedAt,
    }));

    if (
      generation.creditsCost > 0
      && !generation.creditRefundedAt
      && await applyCreditsToUser(ctx, generation.userId, generation.creditsCost)
    ) {
      await ctx.db.patch(args.animationGenerationId, {
        creditRefundedAt: failedAt,
      });
    }
    return null;
  },
});

export const claimAnimationGenerationForWorker = mutation({
  args: {
    workerSecret: v.string(),
  },
  returns: v.union(animationWorkerJobValidator, v.null()),
  handler: async (ctx, args) => {
    assertAnimationWorkerSecret(args.workerSecret);

    const generation = await ctx.db
      .query("animationGenerations")
      .withIndex("by_status_last_progress", (q) => q.eq("status", "intake"))
      .order("asc")
      .first();
    if (!generation) {
      return null;
    }

    const now = Date.now();
    const claimedGeneration = {
      ...generation,
      lastProgressAt: now,
      stageStartedAt: now,
      status: "generating_reference" as const,
      statusMessage: getAnimationGenerationStatusMessage("generating_reference"),
    };

    await ctx.db.patch(generation._id, {
      lastProgressAt: claimedGeneration.lastProgressAt,
      stageStartedAt: claimedGeneration.stageStartedAt,
      status: claimedGeneration.status,
      statusMessage: claimedGeneration.statusMessage,
    });

    return await resolveAnimationWorkerJob(ctx, claimedGeneration);
  },
});

export const getAnimationGenerationForWorker = query({
  args: {
    animationGenerationId: v.id("animationGenerations"),
    workerSecret: v.string(),
  },
  returns: v.union(animationWorkerJobValidator, v.null()),
  handler: async (ctx, args) => {
    assertAnimationWorkerSecret(args.workerSecret);
    const generation = await ctx.db.get(args.animationGenerationId);
    return generation ? await resolveAnimationWorkerJob(ctx, generation) : null;
  },
});

export const markAnimationGenerationStageForWorker = mutation({
  args: {
    animationGenerationId: v.id("animationGenerations"),
    expectedStatus: animationGenerationStatusValidator,
    status: animationGenerationStatusValidator,
    statusMessage: v.optional(v.string()),
    workerSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertAnimationWorkerSecret(args.workerSecret);
    if (args.status === "complete" || args.status === "failed") {
      throw new ConvexError("Use completeAnimationGenerationForWorker or failAnimationGenerationForWorker for terminal statuses");
    }

    const generation = await ctx.db.get(args.animationGenerationId);
    const patch = buildAnimationGenerationStagePatch(
      generation,
      args.expectedStatus,
      args.status as Exclude<AnimationGenerationStatus, "complete" | "failed">,
      Date.now(),
      args.statusMessage,
    );
    if (!patch) {
      return null;
    }

    await ctx.db.patch(args.animationGenerationId, patch);
    return null;
  },
});

export const generateAnimationWorkerUploadUrl = mutation({
  args: {
    workerSecret: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    assertAnimationWorkerSecret(args.workerSecret);
    return await ctx.storage.generateUploadUrl();
  },
});

export const completeAnimationGenerationForWorker = mutation({
  args: {
    animationGenerationId: v.id("animationGenerations"),
    animationQa: animationQaValidator,
    canonicalFrameManifestStorageId: v.id("_storage"),
    expectedStatus: animationGenerationStatusValidator,
    exports: animationExportsValidator,
    previewStorageId: v.id("_storage"),
    workerSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertAnimationWorkerSecret(args.workerSecret);

    const generation = await ctx.db.get(args.animationGenerationId);
    if (
      !generation
      || generation.status !== args.expectedStatus
      || isTerminalAnimationGenerationStatus(generation.status)
    ) {
      return null;
    }
    if (args.animationQa.decision !== "pass") {
      throw new ConvexError("Completion requires passing animation QA");
    }
    if (
      !(
        args.exports.pngSequenceStorageId
        || args.exports.apngStorageId
        || args.exports.runtimeManifestStorageId
        || args.exports.spriteSheetStorageId
        || args.exports.webpSpriteSheetStorageId
      )
    ) {
      throw new ConvexError("Completion requires at least one transparent export");
    }

    await ctx.db.patch(args.animationGenerationId, buildAnimationGenerationCompletionPatch({
      animationQa: args.animationQa,
      canonicalFrameManifestStorageId: args.canonicalFrameManifestStorageId,
      completedAt: Date.now(),
      exports: args.exports,
      previewStorageId: args.previewStorageId,
    }));
    return null;
  },
});

export const requeueAnimationGenerationForWorker = mutation({
  args: {
    animationGenerationId: v.id("animationGenerations"),
    workerError: v.string(),
    workerSecret: v.string(),
  },
  returns: v.union(v.literal("requeued"), v.literal("failed"), v.null()),
  handler: async (ctx, args) => {
    assertAnimationWorkerSecret(args.workerSecret);

    const generation = await ctx.db.get(args.animationGenerationId);
    if (!generation || isTerminalAnimationGenerationStatus(generation.status)) {
      return null;
    }

    const now = Date.now();
    if (generation.retryCount >= ANIMATION_GENERATION_CONFIG.maxWorkerRetries) {
      await ctx.db.patch(args.animationGenerationId, buildAnimationGenerationFailurePatch({
        error: "We couldn't generate a production-ready transparent animation. Your request has been closed and any charged credits were refunded.",
        failedAt: now,
      }));

      if (
        generation.creditsCost > 0
        && !generation.creditRefundedAt
        && await applyCreditsToUser(ctx, generation.userId, generation.creditsCost)
      ) {
        await ctx.db.patch(args.animationGenerationId, {
          creditRefundedAt: now,
        });
      }
      return "failed";
    }

    await ctx.db.patch(
      args.animationGenerationId,
      buildAnimationGenerationRequeuePatch(generation, now),
    );
    return "requeued";
  },
});

export const failAnimationGenerationForWorker = mutation({
  args: {
    animationGenerationId: v.id("animationGenerations"),
    error: v.string(),
    workerSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertAnimationWorkerSecret(args.workerSecret);

    const generation = await ctx.db.get(args.animationGenerationId);
    if (!generation || isTerminalAnimationGenerationStatus(generation.status)) {
      return null;
    }

    const failedAt = Date.now();
    await ctx.db.patch(args.animationGenerationId, buildAnimationGenerationFailurePatch({
      error: args.error,
      failedAt,
    }));

    if (
      generation.creditsCost > 0
      && !generation.creditRefundedAt
      && await applyCreditsToUser(ctx, generation.userId, generation.creditsCost)
    ) {
      await ctx.db.patch(args.animationGenerationId, {
        creditRefundedAt: failedAt,
      });
    }
    return null;
  },
});
