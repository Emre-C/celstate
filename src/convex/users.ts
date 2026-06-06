import { v } from "convex/values";
import type { UserIdentity } from "convex/server";
import { internal } from "./_generated/api.js";
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
  clerkUserId: v.optional(v.string()),
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  credits: v.optional(v.number()),
  stripeCustomerId: v.optional(v.string()),
});

const normalizeOptionalEmail = (email: string | undefined): string | undefined => {
  const t = email?.trim().toLowerCase();
  return t && t.length > 0 ? t : undefined;
};

const resolveAuthProviderFromIdentity = (identity: UserIdentity): ResolvedAuthProvider => {
  const connection =
    (typeof identity["connection_type"] === "string" ? identity["connection_type"] : undefined) ??
    (typeof identity["connectionType"] === "string" ? identity["connectionType"] : undefined);

  const normalized = connection?.toLowerCase() ?? "";
  if (normalized.includes("google")) {
    return "google";
  }
  if (normalized.includes("apple")) {
    return "apple";
  }

  const email = identity.email?.trim().toLowerCase();
  if (email?.endsWith("@privaterelay.appleid.com")) {
    return "apple";
  }

  return "unknown";
};

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
    clerkUserId: string;
    email?: string;
    name?: string;
    image?: string;
    authProvider?: ResolvedAuthProvider;
  },
) => {
  const email = normalizeOptionalEmail(profile.email);

  const patchFromExisting = async (
    existingId: Id<"users">,
    existing: {
      tokenIdentifier?: string;
      email?: string;
      name?: string;
      image?: string;
    },
  ) => {
    await ctx.db.patch(existingId, {
      tokenIdentifier: profile.tokenIdentifier,
      clerkUserId: profile.clerkUserId,
      email: email ?? existing.email,
      name: profile.name ?? existing.name,
      image: profile.image ?? existing.image,
    });
    return (await ctx.db.get(existingId))!;
  };

  const byClerk = await ctx.db
    .query("users")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", profile.clerkUserId))
    .first();

  if (byClerk) {
    return await patchFromExisting(byClerk._id, byClerk);
  }

  const byToken = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", profile.tokenIdentifier))
    .first();

  if (byToken) {
    return await patchFromExisting(byToken._id, byToken);
  }

  if (email) {
    const byEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    if (byEmail) {
      return await patchFromExisting(byEmail._id, byEmail);
    }
  }

  const userId = await ctx.db.insert("users", {
    tokenIdentifier: profile.tokenIdentifier,
    clerkUserId: profile.clerkUserId,
    email,
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
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }

  const clerkUserId = identity.subject?.trim();
  if (!clerkUserId) {
    throw new Error("Missing auth subject (Clerk sub).");
  }

  if (identity.emailVerified === false) {
    throw new Error("Email must be verified before using Celstate.");
  }

  const authProvider = resolveAuthProviderFromIdentity(identity);

  return await upsertUserRecord(ctx, {
    tokenIdentifier: identity.tokenIdentifier,
    clerkUserId,
    email: identity.email ?? undefined,
    name: identity.name ?? undefined,
    image: identity.pictureUrl ?? undefined,
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

