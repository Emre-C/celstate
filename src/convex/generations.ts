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
import { getCurrentAppUser, upsertCurrentUser } from "./users.js";

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

    // Insert the "generating" row — visible to reactive queries immediately
    const generationId = await ctx.db.insert("generations", {
      userId,
      prompt: args.prompt,
      status: "generating" as const,
      referenceStorageIds: referenceStorageIds.length > 0 ? referenceStorageIds : undefined,
      creditsCost,
      aspectRatio,
      createdAt: Date.now(),
    });

    // Schedule the long-running Node action to do actual image generation
    await ctx.scheduler.runAfter(0, internal.generation.generateWorker, {
      generationId,
      prompt: args.prompt,
      referenceStorageIds: referenceStorageIds.length > 0 ? referenceStorageIds : undefined,
      aspectRatio,
    });

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
    await ctx.db.patch(args.generationId, {
      status: "complete",
      resultStorageId: args.resultStorageId,
      optimizedStorageId: args.optimizedStorageId,
      whiteBgStorageId: args.whiteBgStorageId,
      blackBgStorageId: args.blackBgStorageId,
      completedAt: Date.now(),
      generationTimeMs: args.generationTimeMs,
      retryCount: args.retryCount,
      dimensionMismatch: args.dimensionMismatch,
    });
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
    await ctx.db.patch(args.generationId, {
      status: "failed",
      error: args.error,
    });
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
      completedAt: v.optional(v.number()),
      error: v.optional(v.string()),
      generationTimeMs: v.optional(v.number()),
      retryCount: v.optional(v.number()),
      dimensionMismatch: v.optional(v.boolean()),
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
      completedAt: v.optional(v.number()),
      error: v.optional(v.string()),
      generationTimeMs: v.optional(v.number()),
      retryCount: v.optional(v.number()),
      dimensionMismatch: v.optional(v.boolean()),
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
      statusMessage: args.statusMessage,
    });
    return null;
  },
});

export const cleanupStaleGenerations = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const staleThreshold = Date.now() - 5 * 60 * 1000; // 5 minutes
    const stale = await ctx.db
      .query("generations")
      .withIndex("by_status", (q) => q.eq("status", "generating"))
      .collect();

    for (const gen of stale) {
      if (gen.createdAt < staleThreshold) {
        await ctx.db.patch(gen._id, {
          status: "failed",
          error: "Generation timed out after 5 minutes",
        });
        // Refund credits
        const user = await ctx.db.get(gen.userId);
        if (user) {
          await ctx.db.patch(gen.userId, {
            credits: (user.credits ?? 0) + gen.creditsCost,
          });
        }
      }
    }
    return null;
  },
});
