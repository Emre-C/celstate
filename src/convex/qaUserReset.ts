import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { internalMutation, type MutationCtx } from "./_generated/server.js";
import {
  assertEmailAllowlistedForQaReset,
  assertQaUserResetSecret,
} from "./lib/qa/qaUserResetSecret.js";
import { purgeUserPurchaseStateHelper } from "./lib/creditPackPurchase/lifecycle.js";
import {
  storageIdsFromAnimationGeneration,
  storageIdsFromGeneration,
} from "./lib/generationArtifactStorage.js";

const GENERATION_BATCH = 80;

async function deleteGenerationsAndOpsForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  let removed = 0;
  while (true) {
    const batch = await ctx.db
      .query("generations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(GENERATION_BATCH);

    if (batch.length === 0) break;

    const storageAcc: Id<"_storage">[] = [];
    for (const gen of batch) {
      storageAcc.push(...storageIdsFromGeneration(gen));
      const events = await ctx.db
        .query("generationOpsEvents")
        .withIndex("by_generation", (q) => q.eq("generationId", gen._id))
        .collect();
      for (const ev of events) {
        await ctx.db.delete("generationOpsEvents", ev._id);
      }
      await ctx.db.delete("generations", gen._id);
      removed++;
    }

    if (storageAcc.length > 0) {
      await ctx.runMutation(internal.generations.deleteStorageFiles, {
        storageIds: storageAcc,
        reason: "qa_user_reset",
      });
    }
  }
  return removed;
}

async function deleteAnimationGenerationsForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  let removed = 0;
  while (true) {
    const batch = await ctx.db
      .query("animationGenerations")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .take(GENERATION_BATCH);

    if (batch.length === 0) break;

    const storageAcc: Id<"_storage">[] = [];
    for (const gen of batch) {
      storageAcc.push(...storageIdsFromAnimationGeneration(gen));
      await ctx.db.delete("animationGenerations", gen._id);
      removed++;
    }

    if (storageAcc.length > 0) {
      await ctx.runMutation(internal.generations.deleteStorageFiles, {
        storageIds: storageAcc,
        reason: "qa_user_reset",
      });
    }
  }
  return removed;
}

/**
 * Wipes an allowlisted email from the Celstate app database.
 * Does not delete Stripe customers or payment history in Stripe itself.
 *
 * Scoped to a single allowlisted QA email — never scans or wipes all users.
 *
 * Clerk sessions / refresh tokens are owned by Clerk — revoke the user
 * from the Clerk dashboard if you must invalidate remote tokens.
 *
 * Configure Convex env:
 * - `QA_USER_RESET_SECRET` — shared secret for this mutation’s `secret` arg
 * - `QA_USER_RESET_ALLOWED_EMAILS` — comma-separated lowercase emails (e.g. `ycoklar@gmail.com`)
 *
 * Preferred invocation: `pnpm reset-qa` (runs scripts/reset-qa.ts, targets prod).
 */
export const resetAllowlistedTestUser = internalMutation({
  args: {
    secret: v.string(),
    email: v.string(),
  },
  returns: v.object({
    appUserDeleted: v.boolean(),
    animationGenerationsRemoved: v.number(),
    generationsRemoved: v.number(),
    clerkSessionsNote: v.string(),
  }),
  handler: async (ctx, args) => {
    assertQaUserResetSecret(args.secret);
    const normalizedEmail = args.email.trim().toLowerCase();
    assertEmailAllowlistedForQaReset(normalizedEmail);

    const appUser =
      (await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", normalizedEmail))
        .first()) ??
      (await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", args.email.trim()))
        .first());

    let generationsRemoved = 0;
    let animationGenerationsRemoved = 0;
    if (appUser) {
      const userId = appUser._id;

      for (const key of await ctx.db
        .query("mcpApiKeys")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()) {
        await ctx.db.delete("mcpApiKeys", key._id);
      }

      generationsRemoved = await deleteGenerationsAndOpsForUser(ctx, userId);
      animationGenerationsRemoved = await deleteAnimationGenerationsForUser(ctx, userId);

      await purgeUserPurchaseStateHelper(ctx, userId);

      for (const row of await ctx.db
        .query("creditGrants")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()) {
        await ctx.db.delete("creditGrants", row._id);
      }

      for (const row of await ctx.db
        .query("referenceUploadUrlIssues")
        .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
        .collect()) {
        await ctx.db.delete("referenceUploadUrlIssues", row._id);
      }

      await ctx.db.delete("users", userId);
    }

    return {
      appUserDeleted: appUser != null,
      animationGenerationsRemoved,
      generationsRemoved,
      clerkSessionsNote:
        "Clerk sessions are not deleted from this mutation — revoke or delete the user in the Clerk dashboard if remote tokens must be invalidated.",
    };
  },
});
