import { v, ConvexError } from "convex/values";
import { paginationOptsValidator, type Scheduler } from "convex/server";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  internalAction,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { GENERATION_CONFIG, isValidAspectRatio } from "./lib/config.js";
import { insertGenerationOpsEventRow } from "./lib/generationOpsEvents.js";
import { generationStageValidator } from "./lib/validators.js";
import {
  type GenerationStage,
  getGenerationLastProgressAt,
  getGenerationRetryDelayMs,
  getGenerationRetryStatusMessage,
  getGenerationStageStatusMessage,
} from "./lib/generationWorkflow.js";
import {
  classifyGenerationFailureKind,
  normalizeGenerationFailureStage,
} from "../lib/analytics/generation.js";
import { applyCreditsToUser, getCurrentAppUser, upsertCurrentUser } from "./users.js";
import { validateReferenceImageMetadata } from "./lib/validation.js";
import { assertVerificationRunnerSecret } from "./lib/verificationRunnerSecret.js";

const generationWithUrlsValidator = v.object({
  _id: v.id("generations"),
  _creationTime: v.number(),
  userId: v.id("users"),
  prompt: v.string(),
  status: v.union(
    v.literal("generating"),
    v.literal("complete"),
    v.literal("failed"),
  ),
  stage: v.optional(generationStageValidator),
  statusMessage: v.optional(v.string()),
  resultStorageId: v.optional(v.id("_storage")),
  whiteBgStorageId: v.optional(v.id("_storage")),
  blackBgStorageId: v.optional(v.id("_storage")),
  optimizedStorageId: v.optional(v.id("_storage")),
  referenceStorageId: v.optional(v.id("_storage")),
  referenceStorageIds: v.optional(v.array(v.id("_storage"))),
  creditsCost: v.number(),
  aspectRatio: v.string(),
  createdAt: v.number(),
  lastProgressAt: v.optional(v.number()),
  stageStartedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  error: v.optional(v.string()),
  failureKind: v.optional(v.union(
    v.literal("timeout"),
    v.literal("provider_error"),
    v.literal("processing_error"),
    v.literal("unknown"),
  )),
  failureStage: v.optional(generationStageValidator),
  generationTimeMs: v.optional(v.number()),
  retryCount: v.optional(v.number()),
  whiteBgRetryCount: v.optional(v.number()),
  blackBgRetryCount: v.optional(v.number()),
  finalizeRetryCount: v.optional(v.number()),
  whiteBgRetryInstruction: v.optional(v.string()),
  blackBgRetryInstruction: v.optional(v.string()),
  dimensionMismatch: v.optional(v.boolean()),
  stalledAlertedAt: v.optional(v.number()),
  creditRefundedAt: v.optional(v.number()),
  // Storage URL fields resolved at query time
  optimizedUrl: v.union(v.string(), v.null()),
  referenceUrls: v.array(v.string()),
  resultUrl: v.union(v.string(), v.null()),
});

async function scheduleGenerationStage(
  ctx: { scheduler: Scheduler },
  generationId: Id<"generations">,
  stage: GenerationStage,
  delayMs = 0,
): Promise<void> {
  switch (stage) {
    case "white_background":
      await ctx.scheduler.runAfter(delayMs, internal.generation.generateWhiteBackground, {
        generationId,
      });
      return;
    case "black_background":
      await ctx.scheduler.runAfter(delayMs, internal.generation.generateBlackBackground, {
        generationId,
      });
      return;
    case "finalizing":
      await ctx.scheduler.runAfter(delayMs, internal.generation.finalizeGeneration, {
        generationId,
      });
      return;
  }
}

function getGenerationDurationMs(generation: { createdAt: number }, now: number): number {
  return Math.max(0, now - generation.createdAt);
}

function getGenerationAttemptDurationMs(
  generation: {
    createdAt: number;
    lastProgressAt?: number;
    stageStartedAt?: number;
  },
  now: number,
): number {
  return Math.max(0, now - (generation.stageStartedAt ?? generation.lastProgressAt ?? generation.createdAt));
}

function getStageRetryCount(
  generation: {
    blackBgRetryCount?: number;
    finalizeRetryCount?: number;
    whiteBgRetryCount?: number;
  },
  stage: GenerationStage | undefined,
): number | undefined {
  switch (stage) {
    case "white_background":
      return generation.whiteBgRetryCount ?? 0;
    case "black_background":
      return generation.blackBgRetryCount ?? 0;
    case "finalizing":
      return generation.finalizeRetryCount ?? 0;
    default:
      return undefined;
  }
}

async function scheduleGenerationAlert(
  ctx: { scheduler: Scheduler },
  args: {
    alertType: "generation_failed" | "generation_stalled";
    error?: string;
    generationDurationMs?: number;
    generationId: Id<"generations">;
    retryCount?: number;
    severity: "warning" | "critical";
    stage?: GenerationStage;
    statusMessage?: string;
    totalRetryCount?: number;
  },
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.ops.sendGenerationAlert, args);
}

async function validateReferenceStorageIds(
  ctx: Pick<MutationCtx, "db">,
  referenceStorageIds: Id<"_storage">[],
): Promise<void> {
  const seenReferenceStorageIds = new Set<string>();

  for (const storageId of referenceStorageIds) {
    const storageIdKey = String(storageId);
    if (seenReferenceStorageIds.has(storageIdKey)) {
      throw new ConvexError("Duplicate reference images are not allowed");
    }

    seenReferenceStorageIds.add(storageIdKey);

    const validation = validateReferenceImageMetadata(
      await ctx.db.system.get("_storage", storageId),
    );

    if (!validation.valid) {
      throw new ConvexError(validation.reason ?? "Invalid reference image");
    }
  }
}

const generationStatusFilterValidator = v.union(
  v.literal("complete"),
  v.literal("generating"),
  v.literal("failed"),
);

async function resolveGenerationWithUrls(
  ctx: Pick<QueryCtx, "storage">,
  generation: Doc<"generations">,
): Promise<Doc<"generations"> & {
  optimizedUrl: string | null;
  referenceUrls: string[];
  resultUrl: string | null;
}> {
  const referenceStorageIds = generation.referenceStorageIds ??
    (generation.referenceStorageId ? [generation.referenceStorageId] : []);
  const referenceUrls = await Promise.all(
    referenceStorageIds.map((storageId) => ctx.storage.getUrl(storageId)),
  );

  return {
    ...generation,
    optimizedUrl: generation.optimizedStorageId
      ? await ctx.storage.getUrl(generation.optimizedStorageId)
      : null,
    referenceUrls: referenceUrls.filter((url): url is string => url !== null),
    resultUrl: generation.resultStorageId
      ? await ctx.storage.getUrl(generation.resultStorageId)
      : null,
  };
}

async function requestGenerationCore(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    prompt: string;
    referenceStorageIds: Id<"_storage">[];
    aspectRatio: string;
  },
): Promise<Id<"generations">> {
  const appUser = await ctx.db.get(args.userId);
  if (!appUser) {
    throw new ConvexError("User not found");
  }
  const userId = appUser._id;
  const prompt = args.prompt;
  const referenceStorageIds = args.referenceStorageIds;
  const aspectRatio = args.aspectRatio;

  const inFlight = await ctx.db
    .query("generations")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "generating"))
    .collect();
  if (inFlight.length >= GENERATION_CONFIG.maxConcurrentGenerations) {
    throw new ConvexError("Too many generations in progress. Please wait for one to finish.");
  }

  const creditsCost = GENERATION_CONFIG.creditsPerGeneration;

  const userRecord = await ctx.db.get(userId);
  if (!userRecord || (userRecord.credits ?? 0) < creditsCost) {
    throw new ConvexError("Insufficient credits");
  }
  await ctx.db.patch(userId, {
    credits: (userRecord.credits ?? 0) - creditsCost,
  });

  const now = Date.now();
  const generationId = await ctx.db.insert("generations", {
    userId,
    prompt,
    status: "generating" as const,
    stage: "white_background" as const,
    statusMessage: getGenerationStageStatusMessage("white_background"),
    referenceStorageIds: referenceStorageIds.length > 0 ? referenceStorageIds : undefined,
    creditsCost,
    aspectRatio,
    createdAt: now,
    lastProgressAt: now,
    retryCount: 0,
    whiteBgRetryCount: 0,
    blackBgRetryCount: 0,
    finalizeRetryCount: 0,
  });

  await insertGenerationOpsEventRow(ctx, {
    eventType: "generation_requested",
    generationDurationMs: 0,
    generationId,
    retryCount: 0,
    severity: "info",
    stage: "white_background",
    statusMessage: getGenerationStageStatusMessage("white_background"),
    totalRetryCount: 0,
    userEmail: appUser.email,
    userId,
  });

  await scheduleGenerationStage(ctx, generationId, "white_background");

  return generationId;
}

/**
 * Public mutation: atomically deducts credits, inserts a "generating" row,
 * and schedules the internal Node action worker. Returns the generation ID
 * so the reactive query picks up the row immediately.
 */
export const requestGeneration = mutation({
  args: {
    prompt: v.string(),
    referenceStorageIds: v.optional(v.array(v.id("_storage"))),
    aspectRatio: v.optional(v.string()),
  },
  returns: v.id("generations"),
  handler: async (ctx, args) => {
    const appUser = (await getCurrentAppUser(ctx)) ?? await upsertCurrentUser(ctx);

    const prompt = args.prompt.trim();
    if (!prompt) {
      throw new ConvexError("Prompt is required");
    }

    if (prompt.length > GENERATION_CONFIG.maxPromptLength) {
      throw new ConvexError(
        `Prompt too long (max ${GENERATION_CONFIG.maxPromptLength} characters)`,
      );
    }

    const aspectRatio = args.aspectRatio ?? GENERATION_CONFIG.defaultAspectRatio;
    if (!isValidAspectRatio(aspectRatio)) {
      throw new ConvexError(`Unsupported aspect ratio: ${aspectRatio}`);
    }

    const referenceStorageIds = args.referenceStorageIds ?? [];
    if (referenceStorageIds.length > GENERATION_CONFIG.maxReferenceImages) {
      throw new ConvexError(
        `Maximum ${GENERATION_CONFIG.maxReferenceImages} reference images allowed`,
      );
    }

    await validateReferenceStorageIds(ctx, referenceStorageIds);

    return await requestGenerationCore(ctx, {
      userId: appUser._id,
      prompt,
      referenceStorageIds,
      aspectRatio,
    });
  },
});

export const requestGenerationForCanaryRunner = internalMutation({
  args: {
    runnerSecret: v.string(),
    prompt: v.string(),
  },
  returns: v.id("generations"),
  handler: async (ctx, args) => {
    assertVerificationRunnerSecret(args.runnerSecret);
    const principal = await ctx.db
      .query("canaryPrincipals")
      .withIndex("by_principal_id", (q) => q.eq("principalId", "CANARY_GENERATION"))
      .first();
    if (!principal?.appUserId) {
      throw new ConvexError(
        "CANARY_GENERATION is not provisioned (missing canaryPrincipals row or appUserId)",
      );
    }

    const prompt = args.prompt.trim();
    if (!prompt) {
      throw new ConvexError("Prompt is required");
    }
    if (prompt.length > GENERATION_CONFIG.maxPromptLength) {
      throw new ConvexError(
        `Prompt too long (max ${GENERATION_CONFIG.maxPromptLength} characters)`,
      );
    }

    const aspectRatio = GENERATION_CONFIG.defaultAspectRatio;
    const referenceStorageIds: Id<"_storage">[] = [];
    await validateReferenceStorageIds(ctx, referenceStorageIds);

    return await requestGenerationCore(ctx, {
      userId: principal.appUserId,
      prompt,
      referenceStorageIds,
      aspectRatio,
    });
  },
});

export const getGenerationStatusForCanaryRunner = internalQuery({
  args: {
    runnerSecret: v.string(),
    generationId: v.id("generations"),
  },
  returns: v.union(
    v.object({
      status: v.literal("generating"),
      stage: v.optional(generationStageValidator),
    }),
    v.object({
      status: v.literal("complete"),
      creditRefundedAt: v.optional(v.number()),
      resultStorageId: v.optional(v.id("_storage")),
    }),
    v.object({
      status: v.literal("failed"),
      creditRefundedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    assertVerificationRunnerSecret(args.runnerSecret);
    const principal = await ctx.db
      .query("canaryPrincipals")
      .withIndex("by_principal_id", (q) => q.eq("principalId", "CANARY_GENERATION"))
      .first();
    if (!principal?.appUserId) {
      return null;
    }
    const gen = await ctx.db.get(args.generationId);
    if (!gen || gen.userId !== principal.appUserId) {
      return null;
    }
    if (gen.status === "generating") {
      return { status: "generating" as const, stage: gen.stage };
    }
    if (gen.status === "complete") {
      return {
        status: "complete" as const,
        creditRefundedAt: gen.creditRefundedAt,
        resultStorageId: gen.resultStorageId,
      };
    }
    return {
      status: "failed" as const,
      creditRefundedAt: gen.creditRefundedAt,
    };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const appUser = (await getCurrentAppUser(ctx)) ?? await upsertCurrentUser(ctx);
    if ((appUser.credits ?? 0) < GENERATION_CONFIG.creditsPerGeneration) {
      throw new ConvexError("Insufficient credits");
    }

    const now = Date.now();
    const recentUploadUrlIssues = await ctx.db
      .query("referenceUploadUrlIssues")
      .withIndex("by_user_createdAt", (q) =>
        q.eq("userId", appUser._id).gte("createdAt", now - GENERATION_CONFIG.uploadUrlIssueWindowMs)
      )
      .take(GENERATION_CONFIG.maxUploadUrlIssuesPerWindow);

    if (recentUploadUrlIssues.length >= GENERATION_CONFIG.maxUploadUrlIssuesPerWindow) {
      throw new ConvexError("Too many reference uploads requested. Please wait a few minutes and try again.");
    }

    await ctx.db.insert("referenceUploadUrlIssues", {
      userId: appUser._id,
      createdAt: now,
    });

    return await ctx.storage.generateUploadUrl();
  },
});

async function failGenerationRecord(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  generationId: Id<"generations">,
  error: string,
  internalError?: string,
): Promise<void> {
  const generation = await ctx.db.get(generationId);
  if (!generation || generation.status !== "generating") {
    return;
  }

  const now = Date.now();
  const failureKind = classifyGenerationFailureKind({
    error: internalError ?? error,
    stage: generation.stage,
    statusMessage: generation.statusMessage,
  });
  const failureStage = normalizeGenerationFailureStage(generation.stage);

  await ctx.db.patch(generationId, {
    completedAt: now,
    error,
    failureKind,
    failureStage,
    lastProgressAt: now,
    stage: undefined,
    stageStartedAt: undefined,
    status: "failed",
    statusMessage: undefined,
  });

  const user = await ctx.db.get(generation.userId);
  const alertError = internalError ?? error;

  await insertGenerationOpsEventRow(ctx, {
    attemptDurationMs: getGenerationAttemptDurationMs(generation, now),
    error: alertError,
    eventType: "generation_failed",
    generationDurationMs: getGenerationDurationMs(generation, now),
    generationId,
    retryCount: getStageRetryCount(generation, generation.stage),
    severity: "critical",
    stage: generation.stage,
    statusMessage: generation.statusMessage,
    totalRetryCount: generation.retryCount ?? 0,
    userEmail: user?.email,
    userId: generation.userId,
  });

  await scheduleGenerationAlert(ctx, {
    alertType: "generation_failed",
    error: alertError,
    generationDurationMs: getGenerationDurationMs(generation, now),
    generationId,
    retryCount: getStageRetryCount(generation, generation.stage),
    severity: "critical",
    stage: generation.stage,
    statusMessage: generation.statusMessage,
    totalRetryCount: generation.retryCount ?? 0,
  });

  if (generation.creditRefundedAt) {
    return;
  }

  if (!user) {
    return;
  }

  const freshGeneration = await ctx.db.get(generationId);
  if (!freshGeneration || freshGeneration.creditRefundedAt) {
    return;
  }

  await ctx.db.patch(generationId, {
    creditRefundedAt: now,
  });

  await applyCreditsToUser(ctx, generation.userId, generation.creditsCost);
}

export const completeGeneration = internalMutation({
  args: {
    generationId: v.id("generations"),
    resultStorageId: v.id("_storage"),
    optimizedStorageId: v.optional(v.id("_storage")),
    whiteBgStorageId: v.optional(v.id("_storage")),
    blackBgStorageId: v.optional(v.id("_storage")),
    generationTimeMs: v.number(),
    retryCount: v.number(),
    dimensionMismatch: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || generation.status !== "generating") {
      return null;
    }

    const now = Date.now();
    const user = await ctx.db.get(generation.userId);
    await ctx.db.patch(args.generationId, {
      blackBgStorageId: args.blackBgStorageId,
      completedAt: now,
      dimensionMismatch: args.dimensionMismatch,
      generationTimeMs: args.generationTimeMs,
      lastProgressAt: now,
      optimizedStorageId: args.optimizedStorageId,
      resultStorageId: args.resultStorageId,
      retryCount: args.retryCount,
      stage: undefined,
      stageStartedAt: undefined,
      status: "complete",
      statusMessage: undefined,
      whiteBgStorageId: args.whiteBgStorageId,
    });

    await insertGenerationOpsEventRow(ctx, {
      attemptDurationMs: getGenerationAttemptDurationMs(generation, now),
      eventType: "generation_completed",
      generationDurationMs: args.generationTimeMs,
      generationId: args.generationId,
      retryCount: getStageRetryCount(generation, generation.stage),
      severity: "info",
      stage: generation.stage,
      statusMessage: generation.statusMessage,
      totalRetryCount: args.retryCount,
      userEmail: user?.email,
      userId: generation.userId,
    });
    return null;
  },
});

export const markStageAttemptStarted = internalMutation({
  args: {
    generationId: v.id("generations"),
    stage: generationStageValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || generation.status !== "generating" || generation.stage !== args.stage) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(args.generationId, {
      lastProgressAt: now,
      stageStartedAt: now,
    });
    return null;
  },
});

export const recordWhiteBackgroundSuccess = internalMutation({
  args: {
    generationId: v.id("generations"),
    retryCount: v.number(),
    whiteBgStorageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || generation.status !== "generating") {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(args.generationId, {
      lastProgressAt: now,
      stage: "black_background",
      stageStartedAt: undefined,
      statusMessage: getGenerationStageStatusMessage("black_background"),
      whiteBgRetryCount: args.retryCount,
      whiteBgStorageId: args.whiteBgStorageId,
    });

    await insertGenerationOpsEventRow(ctx, {
      attemptDurationMs: getGenerationAttemptDurationMs(generation, now),
      eventType: "stage_succeeded",
      generationDurationMs: getGenerationDurationMs(generation, now),
      generationId: args.generationId,
      retryCount: args.retryCount,
      severity: "info",
      stage: "white_background",
      totalRetryCount: generation.retryCount ?? 0,
      userId: generation.userId,
    });

    await scheduleGenerationStage(ctx, args.generationId, "black_background");
    return null;
  },
});

export const recordBlackBackgroundSuccess = internalMutation({
  args: {
    blackBgStorageId: v.id("_storage"),
    generationId: v.id("generations"),
    retryCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || generation.status !== "generating") {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(args.generationId, {
      blackBgRetryCount: args.retryCount,
      blackBgStorageId: args.blackBgStorageId,
      lastProgressAt: now,
      stage: "finalizing",
      stageStartedAt: undefined,
      statusMessage: getGenerationStageStatusMessage("finalizing"),
    });

    await insertGenerationOpsEventRow(ctx, {
      attemptDurationMs: getGenerationAttemptDurationMs(generation, now),
      eventType: "stage_succeeded",
      generationDurationMs: getGenerationDurationMs(generation, now),
      generationId: args.generationId,
      retryCount: args.retryCount,
      severity: "info",
      stage: "black_background",
      totalRetryCount: generation.retryCount ?? 0,
      userId: generation.userId,
    });

    await scheduleGenerationStage(ctx, args.generationId, "finalizing");
    return null;
  },
});

export const scheduleStageRetry = internalMutation({
  args: {
    generationId: v.id("generations"),
    retryCount: v.number(),
    retryInstruction: v.optional(v.string()),
    stage: generationStageValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || generation.status !== "generating") {
      return null;
    }

    const now = Date.now();
    const totalRetryCount = (generation.retryCount ?? 0) + 1;
    const statusMessage = getGenerationRetryStatusMessage(args.stage, args.retryCount);
    await ctx.db.patch(args.generationId, {
      blackBgRetryCount:
        args.stage === "black_background"
          ? args.retryCount
          : generation.blackBgRetryCount,
      blackBgRetryInstruction:
        args.stage === "black_background"
          ? args.retryInstruction
          : generation.blackBgRetryInstruction,
      finalizeRetryCount:
        args.stage === "finalizing"
          ? args.retryCount
          : generation.finalizeRetryCount,
      lastProgressAt: now,
      retryCount: totalRetryCount,
      stage: args.stage,
      stageStartedAt: undefined,
      statusMessage,
      whiteBgRetryCount:
        args.stage === "white_background"
          ? args.retryCount
          : generation.whiteBgRetryCount,
      whiteBgRetryInstruction:
        args.stage === "white_background"
          ? args.retryInstruction
          : generation.whiteBgRetryInstruction,
    });

    await insertGenerationOpsEventRow(ctx, {
      attemptDurationMs: getGenerationAttemptDurationMs(generation, now),
      eventType: "stage_retry_scheduled",
      generationDurationMs: getGenerationDurationMs(generation, now),
      generationId: args.generationId,
      retryCount: args.retryCount,
      severity: "warning",
      stage: args.stage,
      statusMessage,
      totalRetryCount,
      userId: generation.userId,
    });

    await scheduleGenerationStage(
      ctx,
      args.generationId,
      args.stage,
      getGenerationRetryDelayMs(Math.max(args.retryCount - 1, 0)),
    );

    return null;
  },
});

export const failGeneration = internalMutation({
  args: {
    generationId: v.id("generations"),
    error: v.string(),
    internalError: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await failGenerationRecord(ctx, args.generationId, args.error, args.internalError);
    return null;
  },
});

export const getById = internalQuery({
  args: { generationId: v.id("generations") },
  returns: v.union(
    v.object({
      _id: v.id("generations"),
      _creationTime: v.number(),
      userId: v.id("users"),
      prompt: v.string(),
      status: v.union(
        v.literal("generating"),
        v.literal("complete"),
        v.literal("failed"),
      ),
      statusMessage: v.optional(v.string()),
      resultStorageId: v.optional(v.id("_storage")),
      whiteBgStorageId: v.optional(v.id("_storage")),
      blackBgStorageId: v.optional(v.id("_storage")),
      optimizedStorageId: v.optional(v.id("_storage")),
      referenceStorageId: v.optional(v.id("_storage")),
      referenceStorageIds: v.optional(v.array(v.id("_storage"))),
      creditsCost: v.number(),
      aspectRatio: v.string(),
      createdAt: v.number(),
      lastProgressAt: v.optional(v.number()),
      stageStartedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      error: v.optional(v.string()),
      failureKind: v.optional(v.union(
        v.literal("timeout"),
        v.literal("provider_error"),
        v.literal("processing_error"),
        v.literal("unknown"),
      )),
      failureStage: v.optional(generationStageValidator),
      generationTimeMs: v.optional(v.number()),
      retryCount: v.optional(v.number()),
      whiteBgRetryCount: v.optional(v.number()),
      blackBgRetryCount: v.optional(v.number()),
      finalizeRetryCount: v.optional(v.number()),
      whiteBgRetryInstruction: v.optional(v.string()),
      blackBgRetryInstruction: v.optional(v.string()),
      dimensionMismatch: v.optional(v.boolean()),
      stalledAlertedAt: v.optional(v.number()),
      creditRefundedAt: v.optional(v.number()),
      stage: v.optional(generationStageValidator),
      }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.generationId);
  },
});

export const getByUserWithUrls = query({
  args: {},
  returns: v.array(generationWithUrlsValidator),
  handler: async (ctx) => {
    const appUser = await getCurrentAppUser(ctx);
    if (!appUser) {
      return [];
    }
    const generations = await ctx.db
      .query("generations")
      .withIndex("by_user", (q) => q.eq("userId", appUser._id))
      .order("desc")
      .take(50);

    return Promise.all(generations.map((generation) => resolveGenerationWithUrls(ctx, generation)));
  },
});

export const listByUserWithUrls = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(generationStatusFilterValidator),
  },
  returns: v.array(generationWithUrlsValidator),
  handler: async (ctx, args) => {
    const appUser = await getCurrentAppUser(ctx);
    if (!appUser) {
      return [];
    }

    const limit = Math.min(Math.max(args.limit ?? 5, 1), 10);
    const status = args.status;
    const generations = status
      ? await ctx.db
        .query("generations")
        .withIndex("by_user_status", (q) => q.eq("userId", appUser._id).eq("status", status))
        .order("desc")
        .take(limit)
      : await ctx.db
        .query("generations")
        .withIndex("by_user", (q) => q.eq("userId", appUser._id))
        .order("desc")
        .take(limit);

    return Promise.all(generations.map((generation) => resolveGenerationWithUrls(ctx, generation)));
  },
});

export const getByUserAndIdWithUrls = query({
  args: {
    generationId: v.string(),
  },
  returns: v.union(generationWithUrlsValidator, v.null()),
  handler: async (ctx, args) => {
    const appUser = await getCurrentAppUser(ctx);
    if (!appUser) {
      return null;
    }

    const generationId = ctx.db.normalizeId("generations", args.generationId);
    if (!generationId) {
      return null;
    }

    const generation = await ctx.db.get(generationId);
    if (!generation || generation.userId !== appUser._id) {
      return null;
    }

    return resolveGenerationWithUrls(ctx, generation);
  },
});

export const updateStatusMessage = internalMutation({
  args: {
    generationId: v.id("generations"),
    statusMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.generationId, {
      lastProgressAt: Date.now(),
      stalledAlertedAt: undefined,
      statusMessage: args.statusMessage,
    });
    return null;
  },
});

export const cleanupExpiredUploadUrlIssues = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - GENERATION_CONFIG.uploadUrlIssueWindowMs;
    const expired = await ctx.db
      .query("referenceUploadUrlIssues")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(GENERATION_CONFIG.orphanedUploadCleanupBatchSize);

    for (const row of expired) {
      await ctx.db.delete("referenceUploadUrlIssues", row._id);
    }
    return null;
  },
});

/**
 * Returns old image file IDs that are candidates for orphan deletion.
 * Bounded by scanLimit to avoid reading unbounded storage metadata.
 */
export const getOrphanCleanupCandidates = internalQuery({
  args: { cutoff: v.number(), scanLimit: v.number() },
  returns: v.array(v.id("_storage")),
  handler: async (ctx, args) => {
    const files = await ctx.db.system
      .query("_storage")
      .order("desc")
      .take(args.scanLimit);

    return files
      .filter(
        (f) =>
          f._creationTime < args.cutoff &&
          (f.contentType === "image/jpeg" ||
            f.contentType === "image/png" ||
            f.contentType === "image/webp"),
      )
      .map((f) => f._id);
  },
});

/**
 * Returns one page of storage IDs referenced by generations for orphan
 * cross-referencing. Used by cleanupOrphanedReferenceUploads to paginate
 * the full generations table without holding it all in memory at once.
 */
export const getGenerationStorageIdPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    storageIds: v.array(v.id("_storage")),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { page, continueCursor, isDone } = await ctx.db
      .query("generations")
      .paginate(args.paginationOpts);

    const storageIds: Id<"_storage">[] = [];
    for (const gen of page) {
      if (gen.referenceStorageId) storageIds.push(gen.referenceStorageId);
      if (gen.referenceStorageIds) storageIds.push(...gen.referenceStorageIds);
      if (gen.resultStorageId) storageIds.push(gen.resultStorageId);
      if (gen.whiteBgStorageId) storageIds.push(gen.whiteBgStorageId);
      if (gen.blackBgStorageId) storageIds.push(gen.blackBgStorageId);
      if (gen.optimizedStorageId) storageIds.push(gen.optimizedStorageId);
    }

    return { storageIds, continueCursor, isDone };
  },
});

/**
 * Deletes a batch of storage files; separated from the action so it runs
 * inside a mutation where ctx.storage.delete is available.
 */
export const deleteStorageFiles = internalMutation({
  args: { storageIds: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const storageId of args.storageIds) {
      await ctx.storage.delete(storageId);
    }
    return null;
  },
});

/**
 * Replaces the old unbounded-collect approach. This action paginates through
 * all generations (200 at a time) to build a referenced-IDs set, then deletes
 * orphaned storage files up to batchSize per invocation. Safe to run on large
 * tables because it never issues an unbound .collect() query.
 */
export const cleanupOrphanedReferenceUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - GENERATION_CONFIG.orphanedUploadMaxAgeMs;
    const batchSize = GENERATION_CONFIG.orphanedUploadCleanupBatchSize;

    // Type annotations required: calling functions defined in the same file.
    const candidates: Id<"_storage">[] = await ctx.runQuery(
      internal.generations.getOrphanCleanupCandidates,
      { cutoff, scanLimit: batchSize * 5 },
    );

    if (candidates.length === 0) return null;

    // Paginate the full generations table to collect every referenced storage ID.
    const referencedIds = new Set<string>();
    let paginationOpts: { numItems: number; cursor: string | null } = {
      numItems: 200,
      cursor: null,
    };

    for (;;) {
      const result: { storageIds: Id<"_storage">[]; continueCursor: string; isDone: boolean } =
        await ctx.runQuery(
          internal.generations.getGenerationStorageIdPage,
          { paginationOpts },
        );

      for (const id of result.storageIds) {
        referencedIds.add(String(id));
      }

      if (result.isDone) break;
      paginationOpts = { numItems: 200, cursor: result.continueCursor };
    }

    const orphanedIds = candidates
      .filter((id) => !referencedIds.has(String(id)))
      .slice(0, batchSize);

    if (orphanedIds.length > 0) {
      await ctx.runMutation(internal.generations.deleteStorageFiles, {
        storageIds: orphanedIds,
      });
    }

    return null;
  },
});

export const cleanupStaleGenerations = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const warningThreshold = now - GENERATION_CONFIG.stalledGenerationWarningMs;
    const staleThreshold = now - GENERATION_CONFIG.staleGenerationTimeoutMs;
    const stale = await ctx.db
      .query("generations")
      .withIndex("by_status", (q) => q.eq("status", "generating"))
      .collect();

    for (const gen of stale) {
      const lastProgressAt = getGenerationLastProgressAt(gen);

      if (lastProgressAt < staleThreshold) {
        await failGenerationRecord(
          ctx,
          gen._id,
          "Generation timed out before completion. Your credit has been refunded — please try again.",
          `Generation exceeded ${GENERATION_CONFIG.staleGenerationTimeoutMs}ms without progress`,
        );
        continue;
      }

      if (!gen.stalledAlertedAt && lastProgressAt < warningThreshold) {
        const stallError = `Generation exceeded ${GENERATION_CONFIG.stalledGenerationWarningMs}ms without progress`;

        await ctx.db.patch(gen._id, {
          stalledAlertedAt: now,
        });

        await insertGenerationOpsEventRow(ctx, {
          attemptDurationMs: getGenerationAttemptDurationMs(gen, now),
          error: stallError,
          eventType: "generation_stalled",
          generationDurationMs: getGenerationDurationMs(gen, now),
          generationId: gen._id,
          retryCount: getStageRetryCount(gen, gen.stage),
          severity: "warning",
          stage: gen.stage,
          statusMessage: gen.statusMessage,
          totalRetryCount: gen.retryCount ?? 0,
          userId: gen.userId,
        });

        await scheduleGenerationAlert(ctx, {
          alertType: "generation_stalled",
          error: stallError,
          generationDurationMs: getGenerationDurationMs(gen, now),
          generationId: gen._id,
          retryCount: getStageRetryCount(gen, gen.stage),
          severity: "warning",
          stage: gen.stage,
          statusMessage: gen.statusMessage,
          totalRetryCount: gen.retryCount ?? 0,
        });
      }
    }
    return null;
  },
});

// --- Internal functions for MCP tool handlers ---
// These accept userId directly (resolved from API key, not ctx.auth).

export const requestGenerationForMcp = internalMutation({
  args: {
    userId: v.id("users"),
    prompt: v.string(),
    aspectRatio: v.string(),
  },
  returns: v.id("generations"),
  handler: async (ctx, args) => {
    const prompt = args.prompt.trim();
    if (!prompt) {
      throw new ConvexError("Prompt is required");
    }
    if (prompt.length > GENERATION_CONFIG.maxPromptLength) {
      throw new ConvexError(
        `Prompt too long (max ${GENERATION_CONFIG.maxPromptLength} characters)`,
      );
    }
    if (!isValidAspectRatio(args.aspectRatio)) {
      throw new ConvexError(`Unsupported aspect ratio: ${args.aspectRatio}`);
    }

    return requestGenerationCore(ctx, {
      userId: args.userId,
      prompt,
      referenceStorageIds: [],
      aspectRatio: args.aspectRatio,
    });
  },
});

export const getGenerationForMcp = internalQuery({
  args: {
    userId: v.id("users"),
    generationId: v.string(),
  },
  returns: v.union(generationWithUrlsValidator, v.null()),
  handler: async (ctx, args) => {
    const generationId = ctx.db.normalizeId("generations", args.generationId);
    if (!generationId) {
      return null;
    }
    const generation = await ctx.db.get(generationId);
    if (!generation || generation.userId !== args.userId) {
      return null;
    }
    return resolveGenerationWithUrls(ctx, generation);
  },
});

export const listGenerationsForMcp = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.number(),
    status: v.optional(generationStatusFilterValidator),
  },
  returns: v.array(generationWithUrlsValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit, 1), 10);
    const status = args.status;
    const generations = status
      ? await ctx.db
        .query("generations")
        .withIndex("by_user_status", (q) => q.eq("userId", args.userId).eq("status", status))
        .order("desc")
        .take(limit)
      : await ctx.db
        .query("generations")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .order("desc")
        .take(limit);

    return Promise.all(generations.map((g) => resolveGenerationWithUrls(ctx, g)));
  },
});

export const getCreditsForMcp = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return user?.credits ?? 0;
  },
});
