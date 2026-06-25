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
import type { Doc, Id } from "./_generated/dataModel.js";
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
  const email = identity.email?.trim().toLowerCase();
  if (email?.endsWith("@privaterelay.appleid.com")) {
    return "apple";
  }

  return "unknown";
};

type IdentityProfile = {
  clerkUserId?: string;
  email?: string;
  emailVerified?: boolean | null;
  tokenIdentifier?: string;
};

/**
 * Finds every existing row a given identity could map to. A single Clerk sign-in
 * can match more than one row during the WorkOS→Clerk cutover: a legacy account
 * keyed by email/token, plus a `clerkUserId`-only shell created on first Clerk
 * sign-in. Email matching requires a *verified* email (never `emailVerified === false`)
 * so an unverified identity cannot take over an established account.
 */
const lookupUsersForIdentity = async (
  ctx: QueryCtx | MutationCtx,
  profile: IdentityProfile,
): Promise<Doc<"users">[]> => {
  const email = normalizeOptionalEmail(profile.email);
  const emailLookupAllowed = profile.emailVerified !== false && !!email;
  const clerkUserId = profile.clerkUserId?.trim();

  const byClerk = clerkUserId
    ? await ctx.db
        .query("users")
        .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
        .first()
    : null;

  const byToken = profile.tokenIdentifier
    ? await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", profile.tokenIdentifier!))
        .first()
    : null;

  const byEmail = emailLookupAllowed
    ? await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .first()
    : null;

  // De-duplicate by _id, then order oldest-first. The oldest row is canonical
  // because it carries the established history (credits, generations, billing);
  // a cutover shell is always newer. Read and write paths share this ordering so
  // queries resolve to the same row the next `storeUser` will consolidate onto.
  const seen = new Set<string>();
  const candidates: Doc<"users">[] = [];
  for (const row of [byClerk, byToken, byEmail]) {
    if (row && !seen.has(row._id)) {
      seen.add(row._id);
      candidates.push(row);
    }
  }
  candidates.sort((a, b) => a._creationTime - b._creationTime);
  return candidates;
};

export const getCurrentAppUser = async (ctx: QueryCtx | MutationCtx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  const candidates = await lookupUsersForIdentity(ctx, {
    clerkUserId: identity.subject,
    email: identity.email,
    emailVerified: identity.emailVerified,
    tokenIdentifier: identity.tokenIdentifier,
  });

  return candidates[0] ?? null;
};

/**
 * Repoints a duplicate user's owned records onto the canonical row, copies over
 * any account state the canonical row is missing (billing, profile), and deletes
 * the duplicate. Used to consolidate a WorkOS→Clerk cutover shell into the
 * established account. The child-table list mirrors `qaUserReset` — every table
 * keyed by `userId` must be repointed or the rows would be orphaned.
 *
 * Credits are intentionally NOT summed: the canonical (older) row keeps its own
 * balance, and the duplicate's default sign-up grant is discarded to avoid
 * double-granting. Purchased balance is preserved because real purchases live on
 * the canonical account that predates any shell.
 */
const mergeUserInto = async (
  ctx: MutationCtx,
  canonical: Doc<"users">,
  duplicate: Doc<"users">,
) => {
  if (canonical._id === duplicate._id) {
    return;
  }

  const dupId = duplicate._id;
  const canonicalId = canonical._id;

  for (const key of await ctx.db
    .query("mcpApiKeys")
    .withIndex("by_user", (q) => q.eq("userId", dupId))
    .collect()) {
    await ctx.db.patch(key._id, { userId: canonicalId });
  }

  for (const gen of await ctx.db
    .query("generations")
    .withIndex("by_user", (q) => q.eq("userId", dupId))
    .collect()) {
    await ctx.db.patch(gen._id, { userId: canonicalId });
    // generationOpsEvents has no by_user index; reach its rows via the generation
    // they belong to and keep the denormalized userId consistent.
    for (const ev of await ctx.db
      .query("generationOpsEvents")
      .withIndex("by_generation", (q) => q.eq("generationId", gen._id))
      .collect()) {
      await ctx.db.patch(ev._id, { userId: canonicalId });
    }
  }

  for (const gen of await ctx.db
    .query("lottieGenerations")
    .withIndex("by_user_created", (q) => q.eq("userId", dupId))
    .collect()) {
    await ctx.db.patch(gen._id, { userId: canonicalId });
  }

  for (const grant of await ctx.db
    .query("creditGrants")
    .withIndex("by_user", (q) => q.eq("userId", dupId))
    .collect()) {
    await ctx.db.patch(grant._id, { userId: canonicalId });
  }

  for (const checkout of await ctx.db
    .query("pendingCheckouts")
    .withIndex("by_user_status", (q) => q.eq("userId", dupId))
    .collect()) {
    await ctx.db.patch(checkout._id, { userId: canonicalId });
  }

  for (const settlement of await ctx.db
    .query("purchaseSettlements")
    .withIndex("by_user", (q) => q.eq("userId", dupId))
    .collect()) {
    await ctx.db.patch(settlement._id, { userId: canonicalId });
  }

  for (const issue of await ctx.db
    .query("referenceUploadUrlIssues")
    .withIndex("by_user_createdAt", (q) => q.eq("userId", dupId))
    .collect()) {
    await ctx.db.patch(issue._id, { userId: canonicalId });
  }

  // Backfill account state the canonical row lacks (never overwrite existing).
  const backfill: Partial<Doc<"users">> = {};
  if (!canonical.stripeCustomerId && duplicate.stripeCustomerId) {
    backfill.stripeCustomerId = duplicate.stripeCustomerId;
  }
  if (!canonical.email && duplicate.email) {
    backfill.email = duplicate.email;
  }
  if (!canonical.name && duplicate.name) {
    backfill.name = duplicate.name;
  }
  if (!canonical.image && duplicate.image) {
    backfill.image = duplicate.image;
  }
  if ((canonical.credits ?? undefined) === undefined && duplicate.credits !== undefined) {
    backfill.credits = duplicate.credits;
  }
  if (Object.keys(backfill).length > 0) {
    await ctx.db.patch(canonicalId, backfill);
  }

  await ctx.db.delete(dupId);
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

  const candidates = await lookupUsersForIdentity(ctx, {
    clerkUserId: profile.clerkUserId,
    email: profile.email,
    emailVerified: true,
    tokenIdentifier: profile.tokenIdentifier,
  });

  if (candidates.length > 0) {
    const canonical = candidates[0]!;

    // Consolidate any other rows this identity matched (cutover shells) so a
    // verified human maps to exactly one row. Re-read canonical afterward to pick
    // up any backfilled fields before binding the current identity onto it.
    for (const duplicate of candidates.slice(1)) {
      await mergeUserInto(ctx, canonical, duplicate);
    }
    const merged = (await ctx.db.get(canonical._id)) ?? canonical;

    await ctx.db.patch(merged._id, {
      tokenIdentifier: profile.tokenIdentifier,
      clerkUserId: profile.clerkUserId,
      email: email ?? merged.email,
      name: profile.name ?? merged.name,
      image: profile.image ?? merged.image,
    });
    return (await ctx.db.get(merged._id))!;
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
      auth_provider: profile.authProvider ?? "unknown",
      email: user.email,
      initial_credits: GENERATION_CONFIG.initialCredits,
      name: user.name,
      user_id: String(userId),
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

  // The `email` claim is the only key that links a Clerk sign-in back to an
  // established account (legacy WorkOS rows, or a cutover shell). If it is
  // absent the Convex JWT template is missing the `email` claim — without it
  // account adoption/merge silently cannot run and the user is stranded on a
  // clerkUserId-only shell. Surface it loudly in Convex logs.
  if (!normalizeOptionalEmail(identity.email ?? undefined)) {
    console.warn(
      `Clerk identity ${clerkUserId} has no email claim — add "email" and ` +
        `"email_verified" to the Convex JWT template in Clerk. Account linking ` +
        `and cutover-shell consolidation cannot run without it.`,
    );
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


