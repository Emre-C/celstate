import { v, ConvexError } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { GENERATION_CONFIG, isValidAspectRatio } from "./lib/config.js";
import {
  type GenerationStage,
  getGenerationLastProgressAt,
  getGenerationRetryDelayMs,
  getGenerationRetryStatusMessage,
  getGenerationStageStatusMessage,
} from "./lib/generationWorkflow.js";
import { getCurrentAppUser, upsertCurrentUser } from "./users.js";

async function scheduleGenerationStage(
  ctx: { scheduler: { runAfter: (...args: any[]) => Promise<unknown> } },
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
    const userId = appUser._id;

    if (args.prompt.length > GENERATION_CONFIG.maxPromptLength) {
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

    const inFlight = await ctx.db
      .query("generations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "generating"))
      .collect();
    if (inFlight.length >= GENERATION_CONFIG.maxConcurrentGenerations) {
      throw new ConvexError("Too many generations in progress. Please wait for one to finish.");
    }

    const creditsCost = GENERATION_CONFIG.creditsPerGeneration;

    // Atomic: check + deduct credits
    const userRecord = await ctx.db.get(userId);
    if (!userRecord || (userRecord.credits ?? 0) < creditsCost) {
      throw new ConvexError("Insufficient credits");
    }
    await ctx.db.patch(userId, {
      credits: (userRecord.credits ?? 0) - creditsCost,
    });

    const now = Date.now();
    // Insert the "generating" row — visible to reactive queries immediately
    const generationId = await ctx.db.insert("generations", {
      userId,
      prompt: args.prompt,
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

    await scheduleGenerationStage(ctx, generationId, "white_background");

    return generationId;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const appUser = await getCurrentAppUser(ctx);
    if (!appUser) throw new Error("Unauthorized");
    if ((appUser.credits ?? 0) < GENERATION_CONFIG.creditsPerGeneration) {
      throw new ConvexError("Insufficient credits");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

async function failGenerationRecord(
  ctx: {
    db: {
      get: (id: Id<"generations"> | Id<"users">) => Promise<any>;
      patch: (id: Id<"generations"> | Id<"users">, value: Record<string, unknown>) => Promise<unknown>;
    };
  },
  generationId: Id<"generations">,
  error: string,
): Promise<void> {
  const generation = await ctx.db.get(generationId);
  if (!generation || generation.status === "complete") {
    return;
  }

  const now = Date.now();
  await ctx.db.patch(generationId, {
    completedAt: now,
    error,
    lastProgressAt: now,
    stage: undefined,
    status: "failed",
    statusMessage: undefined,
  });

  if (generation.creditRefundedAt) {
    return;
  }

  const user = await ctx.db.get(generation.userId);
  if (!user) {
    return;
  }

  await ctx.db.patch(generation.userId, {
    credits: (user.credits ?? 0) + generation.creditsCost,
  });
  await ctx.db.patch(generationId, {
    creditRefundedAt: now,
  });
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
      status: "complete",
      statusMessage: undefined,
      whiteBgStorageId: args.whiteBgStorageId,
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
      statusMessage: getGenerationStageStatusMessage("black_background"),
      whiteBgRetryCount: args.retryCount,
      whiteBgStorageId: args.whiteBgStorageId,
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
      statusMessage: getGenerationStageStatusMessage("finalizing"),
    });
    await scheduleGenerationStage(ctx, args.generationId, "finalizing");
    return null;
  },
});

export const scheduleStageRetry = internalMutation({
  args: {
    generationId: v.id("generations"),
    retryCount: v.number(),
    stage: v.union(
      v.literal("white_background"),
      v.literal("black_background"),
      v.literal("finalizing"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || generation.status !== "generating") {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(args.generationId, {
      blackBgRetryCount:
        args.stage === "black_background"
          ? args.retryCount
          : generation.blackBgRetryCount,
      finalizeRetryCount:
        args.stage === "finalizing"
          ? args.retryCount
          : generation.finalizeRetryCount,
      lastProgressAt: now,
      retryCount: (generation.retryCount ?? 0) + 1,
      stage: args.stage,
      statusMessage: getGenerationRetryStatusMessage(args.stage, args.retryCount),
      whiteBgRetryCount:
        args.stage === "white_background"
          ? args.retryCount
          : generation.whiteBgRetryCount,
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await failGenerationRecord(ctx, args.generationId, args.error);
    return null;
  },
});

export const refundCredits = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user) {
      await ctx.db.patch(args.userId, {
        credits: (user.credits ?? 0) + args.amount,
      });
    }
    return null;
  },
});

export const getByUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.array(
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
      completedAt: v.optional(v.number()),
      error: v.optional(v.string()),
      generationTimeMs: v.optional(v.number()),
      retryCount: v.optional(v.number()),
      whiteBgRetryCount: v.optional(v.number()),
      blackBgRetryCount: v.optional(v.number()),
      finalizeRetryCount: v.optional(v.number()),
      dimensionMismatch: v.optional(v.boolean()),
      creditRefundedAt: v.optional(v.number()),
      stage: v.optional(v.union(
        v.literal("white_background"),
        v.literal("black_background"),
        v.literal("finalizing"),
      )),
    }),
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("generations")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
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
      completedAt: v.optional(v.number()),
      error: v.optional(v.string()),
      generationTimeMs: v.optional(v.number()),
      retryCount: v.optional(v.number()),
      whiteBgRetryCount: v.optional(v.number()),
      blackBgRetryCount: v.optional(v.number()),
      finalizeRetryCount: v.optional(v.number()),
      dimensionMismatch: v.optional(v.boolean()),
      creditRefundedAt: v.optional(v.number()),
      stage: v.optional(v.union(
        v.literal("white_background"),
        v.literal("black_background"),
        v.literal("finalizing"),
      )),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.generationId);
  },
});

export const getByUserWithUrls = query({
  args: {},
  handler: async (ctx) => {
    const appUser = await getCurrentAppUser(ctx);
    if (!appUser) {
      return [];
    }
    const generations = await ctx.db
      .query("generations")
      .withIndex("by_user", (q) => q.eq("userId", appUser._id))
      .order("desc")
      .collect();

    return Promise.all(
      generations.map(async (gen) => {
        // Resolve reference URLs from new array field, falling back to legacy single field
        const refIds = gen.referenceStorageIds ?? (gen.referenceStorageId ? [gen.referenceStorageId] : []);
        const referenceUrls = await Promise.all(
          refIds.map((id) => ctx.storage.getUrl(id)),
        );

        return {
          ...gen,
          resultUrl: gen.resultStorageId
            ? await ctx.storage.getUrl(gen.resultStorageId)
            : null,
          optimizedUrl: gen.optimizedStorageId
            ? await ctx.storage.getUrl(gen.optimizedStorageId)
            : null,
          referenceUrls: referenceUrls.filter((url): url is string => url !== null),
        };
      })
    );
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
      statusMessage: args.statusMessage,
    });
    return null;
  },
});

export const cleanupStaleGenerations = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const staleThreshold = Date.now() - GENERATION_CONFIG.staleGenerationTimeoutMs;
    const stale = await ctx.db
      .query("generations")
      .withIndex("by_status", (q) => q.eq("status", "generating"))
      .collect();

    for (const gen of stale) {
      if (getGenerationLastProgressAt(gen) < staleThreshold) {
        await failGenerationRecord(
          ctx,
          gen._id,
          "Generation timed out before completion. Your credit has been refunded — please try again.",
        );
      }
    }
    return null;
  },
});
