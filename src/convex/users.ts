import { v } from "convex/values";
import { authComponent } from "./auth.js";
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { GENERATION_CONFIG } from "./lib/config.js";

const userDoc = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  tokenIdentifier: v.optional(v.string()),
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  credits: v.optional(v.number()),
});

const userProfile = v.object({
  tokenIdentifier: v.string(),
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
});

const getCurrentTokenIdentifier = async (ctx: QueryCtx | MutationCtx) => {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.tokenIdentifier ?? null;
};

export const getCurrentAppUser = async (ctx: QueryCtx | MutationCtx) => {
  const tokenIdentifier = await getCurrentTokenIdentifier(ctx);
  if (!tokenIdentifier) {
    return null;
  }

  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .first();
};

const upsertUserRecord = async (
  ctx: MutationCtx,
  profile: {
    tokenIdentifier: string;
    email?: string;
    name?: string;
    image?: string;
  },
) => {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", profile.tokenIdentifier))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      tokenIdentifier: profile.tokenIdentifier,
      email: profile.email,
      name: profile.name,
      image: profile.image,
    });

    return (await ctx.db.get(existing._id))!;
  }

  const userId = await ctx.db.insert("users", {
    tokenIdentifier: profile.tokenIdentifier,
    email: profile.email,
    name: profile.name,
    image: profile.image,
    credits: GENERATION_CONFIG.initialCredits,
  });

  return (await ctx.db.get(userId))!;
};

export const upsertCurrentUser = async (ctx: MutationCtx) => {
  const tokenIdentifier = await getCurrentTokenIdentifier(ctx);
  if (!tokenIdentifier) {
    throw new Error("Unauthorized");
  }

  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    throw new Error("Authenticated user record not found");
  }

  return await upsertUserRecord(ctx, {
    tokenIdentifier,
    email: authUser.email,
    name: authUser.name,
    image: authUser.image ?? undefined,
  });
};

export const getByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(userDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
  },
});

export const getByTokenIdentifier = internalQuery({
  args: { tokenIdentifier: v.string() },
  returns: v.union(userDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", args.tokenIdentifier))
      .first();
  },
});

export const getMe = query({
  args: {},
  returns: v.union(userDoc, v.null()),
  handler: async (ctx) => {
    return await getCurrentAppUser(ctx);
  },
});

export const storeUser = mutation({
  args: {},
  returns: userDoc,
  handler: async (ctx) => {
    return await upsertCurrentUser(ctx);
  },
});

export const upsertByTokenIdentifier = internalMutation({
  args: userProfile,
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const user = await upsertUserRecord(ctx, args);
    return user._id;
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

export const addCreditsByUserId = internalMutation({
  args: { userId: v.id("users"), amount: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);

    if (!user) {
      return false;
    }

    await ctx.db.patch(args.userId, {
      credits: (user.credits ?? 0) + args.amount,
    });

    return true;
  },
});

export const getStripePriceIds = query({
  args: {},
  returns: v.object({
    starter: v.string(),
    pro: v.string(),
  }),
  handler: async () => {
    return {
      starter: process.env.STRIPE_PRICE_STARTER!,
      pro: process.env.STRIPE_PRICE_PRO!,
    };
  },
});

export const grantWeeklyCredit = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();

    for (const user of users) {
      await ctx.db.patch(user._id, {
        credits: (user.credits ?? 0) + 1,
      });

      await ctx.db.insert("creditGrants", {
        userId: user._id,
        amount: 1,
        reason: "weekly_drip",
        createdAt: Date.now(),
      });
    }
  },
});
