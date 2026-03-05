import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { GENERATION_CONFIG } from "./lib/config.js";

export const createGeneration = internalMutation({
  args: {
    userId: v.id("users"),
    prompt: v.string(),
    creditsCost: v.number(),
    aspectRatio: v.string(),
  },
  returns: v.id("generations"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("generations", {
      userId: args.userId,
      prompt: args.prompt,
      status: "generating",
      creditsCost: args.creditsCost,
      aspectRatio: args.aspectRatio,
      createdAt: Date.now(),
    });
  },
});

export const completeGeneration = internalMutation({
  args: {
    generationId: v.id("generations"),
    resultStorageId: v.id("_storage"),
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

export const deductCredits = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || (user.credits ?? 0) < args.amount) {
      return false;
    }
    await ctx.db.patch(args.userId, {
      credits: (user.credits ?? 0) - args.amount,
    });
    return true;
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

export const getByUser = query({
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
      resultStorageId: v.optional(v.id("_storage")),
      whiteBgStorageId: v.optional(v.id("_storage")),
      blackBgStorageId: v.optional(v.id("_storage")),
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

export const getById = query({
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
      resultStorageId: v.optional(v.id("_storage")),
      whiteBgStorageId: v.optional(v.id("_storage")),
      blackBgStorageId: v.optional(v.id("_storage")),
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) {
      return [];
    }
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", identity.email!))
      .first();
    if (!user) {
      return [];
    }
    const generations = await ctx.db
      .query("generations")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    return Promise.all(
      generations.map(async (gen) => ({
        ...gen,
        resultUrl: gen.resultStorageId
          ? await ctx.storage.getUrl(gen.resultStorageId)
          : null,
      }))
    );
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
