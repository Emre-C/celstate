import { v } from "convex/values";
import { authComponent } from "./auth.js";
import { components, internal } from "./_generated/api.js";
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
  internalAction,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import type { ResolvedAuthProvider } from "../lib/auth/providers.js";
import { GENERATION_CONFIG } from "./lib/config.js";
import { assertStripeEnv } from "./lib/stripeEnv.js";
import { posthog } from "./posthog.js";

const userDoc = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  tokenIdentifier: v.optional(v.string()),
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  credits: v.optional(v.number()),
  stripeCustomerId: v.optional(v.string()),
});

const getCurrentTokenIdentifier = async (ctx: QueryCtx | MutationCtx) => {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.tokenIdentifier ?? null;
};

const getAuthProviderForBetterAuthUser = async (
  ctx: MutationCtx,
  betterAuthUserId: string | undefined,
): Promise<ResolvedAuthProvider> => {
  if (!betterAuthUserId) {
    return "unknown";
  }

  const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "account",
    select: ["providerId"],
    where: [{ field: "userId", operator: "eq", value: betterAuthUserId }],
  });

  const providerId = typeof (account as { providerId?: unknown } | null)?.providerId === "string"
    ? (account as { providerId: string }).providerId
    : undefined;

  return providerId === "google" || providerId === "apple" ? providerId : "unknown";
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
    authProvider?: ResolvedAuthProvider;
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

  // Fallback: find by email to prevent duplicates when tokenIdentifier changes
  if (profile.email) {
    const byEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", profile.email))
      .first();

    if (byEmail) {
      await ctx.db.patch(byEmail._id, {
        tokenIdentifier: profile.tokenIdentifier,
        email: profile.email,
        name: profile.name,
        image: profile.image,
      });

      return (await ctx.db.get(byEmail._id))!;
    }
  }

  const userId = await ctx.db.insert("users", {
    tokenIdentifier: profile.tokenIdentifier,
    email: profile.email,
    name: profile.name,
    image: profile.image,
    credits: GENERATION_CONFIG.initialCredits,
  });

  const user = (await ctx.db.get(userId))!;

  await posthog.capture(ctx, {
    distinctId: String(userId),
    event: "signed_up",
    properties: {
      user_id: String(userId),
      auth_provider: profile.authProvider ?? "unknown",
      initial_credits: GENERATION_CONFIG.initialCredits,
    },
  });

  await ctx.scheduler.runAfter(0, internal.ops.sendSignupAlert, {
    authProvider: profile.authProvider ?? "unknown",
    initialCredits: GENERATION_CONFIG.initialCredits,
    name: user.name,
    userEmail: user.email,
    userId: String(userId),
  });

  return user;
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

  const authProvider = await getAuthProviderForBetterAuthUser(
    ctx,
    typeof (authUser as { userId?: unknown }).userId === "string"
      ? (authUser as { userId: string }).userId
      : undefined,
  );

  return await upsertUserRecord(ctx, {
    tokenIdentifier,
    email: authUser.email,
    name: authUser.name,
    image: authUser.image ?? undefined,
    authProvider,
  });
};

export const getById = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(userDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
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

/** Single implementation for incrementing `users.credits` (grants, refunds, internal tools). */
export async function applyCreditsToUser(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  amount: number,
): Promise<boolean> {
  const user = await ctx.db.get(userId);

  if (!user) {
    return false;
  }

  await ctx.db.patch(userId, {
    credits: (user.credits ?? 0) + amount,
  });

  return true;
}

export const addCreditsByUserId = internalMutation({
  args: { userId: v.id("users"), amount: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await applyCreditsToUser(ctx, args.userId, args.amount);
  },
});

export const getStripePriceIds = query({
  args: {},
  returns: v.object({
    starter: v.string(),
    pro: v.string(),
  }),
  handler: async () => {
    const stripeEnv = assertStripeEnv();
    return {
      starter: stripeEnv.stripePriceStarter,
      pro: stripeEnv.stripePricePro,
    };
  },
});

/**
 * Processes one page of users for the weekly credit drip. Returns pagination
 * state so the action can self-schedule the next batch.
 */
export const grantWeeklyCreditBatch = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    continueCursor: v.string(),
    isDone: v.boolean(),
    processed: v.number(),
  }),
  handler: async (ctx, args) => {
    const cap = GENERATION_CONFIG.weeklyDripCap;
    const { page, continueCursor, isDone } = await ctx.db
      .query("users")
      .paginate({ numItems: 100, cursor: args.cursor });

    let processed = 0;
    for (const user of page) {
      const current = user.credits ?? 0;
      if (current >= cap) continue;

      const grant = cap - current;
      await ctx.db.patch(user._id, { credits: cap });
      await ctx.db.insert("creditGrants", {
        userId: user._id,
        amount: grant,
        reason: "weekly_drip",
        createdAt: Date.now(),
      });
      processed++;
    }

    return { continueCursor, isDone, processed };
  },
});

/**
 * Entry point called by the weekly cron. Processes users in pages of 100 and
 * self-schedules until all users have been visited, preventing the unbounded
 * table scan that would block a single mutation.
 */
export const grantWeeklyCredit = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Type annotation required to avoid TypeScript circularity on same-file calls.
    const result: { continueCursor: string; isDone: boolean; processed: number } =
      await ctx.runMutation(internal.users.grantWeeklyCreditBatch, {
        cursor: args.cursor ?? null,
      });

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.users.grantWeeklyCredit, {
        cursor: result.continueCursor,
      });
    }

    return null;
  },
});
