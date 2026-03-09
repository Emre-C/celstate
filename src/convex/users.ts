import { v } from "convex/values";
import { query, internalQuery, internalMutation } from "./_generated/server.js";
import { getAuthUserId } from "@convex-dev/auth/server";
import { GENERATION_CONFIG } from "./lib/config.js";

export const getByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      _creationTime: v.number(),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      phone: v.optional(v.string()),
      phoneVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      credits: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
  },
});

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    return await ctx.db.get(userId);
  },
});

export const seedCredits = internalMutation({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (!user) {
      return false;
    }
    await ctx.db.patch(user._id, {
      credits: GENERATION_CONFIG.initialCredits,
    });
    return true;
  },
});

export const addCredits = internalMutation({
  args: { email: v.string(), amount: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (!user) {
      return false;
    }
    await ctx.db.patch(user._id, {
      credits: (user.credits ?? 0) + args.amount,
    });
    return true;
  },
});
