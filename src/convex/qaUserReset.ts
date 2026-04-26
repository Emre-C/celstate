import { v } from "convex/values";
import { components, internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { internalMutation, type MutationCtx } from "./_generated/server.js";
import {
  assertEmailAllowlistedForQaReset,
  assertQaUserResetSecret,
} from "./lib/qaUserResetSecret.js";

const GENERATION_BATCH = 80;
const AUTH_DELETE_PAGE = 200;
const AUTH_DELETE_MAX_PAGES = 40;

type AuthDeleteManyResult = {
  isDone: boolean;
  continueCursor?: string | null;
  count?: number;
};

async function deleteAllBetterAuthWhere(
  ctx: MutationCtx,
  model: "session" | "account" | "user",
  where: Array<{ field: "userId" | "_id"; operator: "eq"; value: string }>,
): Promise<void> {
  let cursor: string | null = null;
  for (let page = 0; page < AUTH_DELETE_MAX_PAGES; page++) {
    const result = (await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: { model, where },
      paginationOpts: { cursor, numItems: AUTH_DELETE_PAGE },
    })) as AuthDeleteManyResult;

    if (result.isDone) {
      return;
    }
    cursor = result.continueCursor ?? null;
  }
  throw new Error(`Better Auth deleteMany exceeded ${AUTH_DELETE_MAX_PAGES} pages for model ${model}`);
}

function storageIdsFromGeneration(gen: Doc<"generations">): Id<"_storage">[] {
  const ids: Id<"_storage">[] = [];
  const push = (id: Id<"_storage"> | undefined) => {
    if (id !== undefined) ids.push(id);
  };
  push(gen.resultStorageId);
  push(gen.whiteBgStorageId);
  push(gen.blackBgStorageId);
  push(gen.optimizedStorageId);
  push(gen.referenceStorageId);
  if (gen.referenceStorageIds) {
    for (const id of gen.referenceStorageIds) {
      ids.push(id);
    }
  }
  return ids;
}

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
        await ctx.db.delete(ev._id);
      }
      await ctx.db.delete(gen._id);
      removed++;
    }

    const uniqueStorage = [...new Set(storageAcc)];
    if (uniqueStorage.length > 0) {
      await ctx.runMutation(internal.generations.deleteStorageFiles, { storageIds: uniqueStorage });
    }
  }
  return removed;
}

/**
 * Wipes an allowlisted email from app DB + Better Auth (sessions, accounts, user).
 * Does not delete Stripe customers or payment history in Stripe itself.
 *
 * Configure Convex env:
 * - `QA_USER_RESET_SECRET` — shared secret for this mutation’s `secret` arg
 * - `QA_USER_RESET_ALLOWED_EMAILS` — comma-separated lowercase emails (e.g. `ycoklar@gmail.com`)
 *
 * Preferred invocation: `pnpm reset-qa` (runs scripts/reset-qa.ts, targets prod).
 * Manual fallback: `npx convex run --prod qaUserReset:resetAllowlistedTestUser '{"secret":"<QA_USER_RESET_SECRET>","email":"ycoklar@gmail.com"}'`
 * Or run it from the Convex dashboard (Functions → qaUserReset → resetAllowlistedTestUser).
 */
export const resetAllowlistedTestUser = internalMutation({
  args: {
    secret: v.string(),
    email: v.string(),
  },
  returns: v.object({
    appUserDeleted: v.boolean(),
    betterAuthUserDeleted: v.boolean(),
    generationsRemoved: v.number(),
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

    const baFirst = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      select: ["_id"],
      where: [{ field: "email", operator: "eq", value: normalizedEmail }],
    })) as { _id?: string } | null;
    const baRecord =
      baFirst ??
      ((await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        select: ["_id"],
        where: [{ field: "email", operator: "eq", value: args.email.trim() }],
      })) as { _id?: string } | null);

    const betterAuthUserId = typeof baRecord?._id === "string" ? baRecord._id : null;

    if (appUser && !betterAuthUserId) {
      throw new Error(
        `QA reset: app user exists for ${normalizedEmail} but no Better Auth user was found. Refusing to partially reset — investigate the inconsistency before re-running.`,
      );
    }

    let generationsRemoved = 0;
    if (appUser) {
      const userId = appUser._id;

      for (const key of await ctx.db
        .query("mcpApiKeys")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()) {
        await ctx.db.delete(key._id);
      }

      generationsRemoved = await deleteGenerationsAndOpsForUser(ctx, userId);

      for (const row of await ctx.db
        .query("creditGrants")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()) {
        await ctx.db.delete(row._id);
      }

      for (const row of await ctx.db
        .query("pendingCheckouts")
        .withIndex("by_user_status", (q) => q.eq("userId", userId))
        .collect()) {
        await ctx.db.delete(row._id);
      }

      for (const row of await ctx.db
        .query("purchaseSettlements")
        .filter((q) => q.eq(q.field("userId"), userId))
        .collect()) {
        await ctx.db.delete(row._id);
      }

      for (const row of await ctx.db
        .query("referenceUploadUrlIssues")
        .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
        .collect()) {
        await ctx.db.delete(row._id);
      }

      await ctx.db.delete(userId);
    }

    let betterAuthUserDeleted = false;
    if (betterAuthUserId) {
      await deleteAllBetterAuthWhere(ctx, "session", [
        { field: "userId", operator: "eq", value: betterAuthUserId },
      ]);
      await deleteAllBetterAuthWhere(ctx, "account", [
        { field: "userId", operator: "eq", value: betterAuthUserId },
      ]);
      await deleteAllBetterAuthWhere(ctx, "user", [
        { field: "_id", operator: "eq", value: betterAuthUserId },
      ]);
      betterAuthUserDeleted = true;
    }

    return {
      appUserDeleted: appUser != null,
      betterAuthUserDeleted,
      generationsRemoved,
    };
  },
});
