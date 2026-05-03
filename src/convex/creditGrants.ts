import { v } from "convex/values";
import { internalQuery, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { creditGrantReasonValidator } from "./lib/validators.js";
import { assertVerificationRunnerSecret } from "./lib/verificationRunnerSecret.js";
import { applyCreditsToUser } from "./users.js";
import { recordCreditPackPurchaseSettlement } from "./lib/stripeCheckout.js";

type PurchaseSettlement = Doc<"purchaseSettlements">;

const settlementSummaryValidator = v.object({
  stripePaymentIntentId: v.string(),
  stripeCheckoutSessionId: v.string(),
  pendingCheckoutId: v.union(v.id("pendingCheckouts"), v.null()),
  userId: v.id("users"),
  priceId: v.string(),
  creditsGranted: v.number(),
  amountUsd: v.number(),
  currency: v.string(),
  creditGrantCount: v.number(),
  revenueEventCount: v.number(),
  refundedAt: v.optional(v.number()),
  stripeRefundId: v.optional(v.string()),
  refundAmountUsd: v.optional(v.number()),
});

async function buildSettlementSummary(
  ctx: QueryCtx | MutationCtx,
  settlements: PurchaseSettlement[],
) {
  if (settlements.length === 0) {
    return null;
  }

  const latestSettlement = settlements.at(-1)!;
  const creditGrants = await ctx.db
    .query("creditGrants")
    .withIndex("by_payment_intent", (q) => q.eq("stripePaymentIntentId", latestSettlement.stripePaymentIntentId))
    .collect();

  return {
    stripePaymentIntentId: latestSettlement.stripePaymentIntentId,
    stripeCheckoutSessionId: latestSettlement.stripeCheckoutSessionId,
    pendingCheckoutId: latestSettlement.pendingCheckoutId,
    userId: latestSettlement.userId,
    priceId: latestSettlement.priceId,
    creditsGranted: latestSettlement.creditsGranted,
    amountUsd: latestSettlement.amountUsd,
    currency: latestSettlement.currency,
    creditGrantCount: creditGrants.length,
    revenueEventCount: settlements.length,
    refundedAt: latestSettlement.refundedAt,
    stripeRefundId: latestSettlement.stripeRefundId,
    refundAmountUsd: latestSettlement.refundAmountUsd,
  };
}

async function getSettlementSummaryByPaymentIntentId(
  ctx: QueryCtx | MutationCtx,
  stripePaymentIntentId: string,
) {
  const settlements = await ctx.db
    .query("purchaseSettlements")
    .withIndex("by_payment_intent", (q) => q.eq("stripePaymentIntentId", stripePaymentIntentId))
    .collect();

  return await buildSettlementSummary(ctx, settlements);
}

async function getSettlementSummaryByPendingCheckoutId(
  ctx: QueryCtx | MutationCtx,
  pendingCheckoutId: Id<"pendingCheckouts">,
) {
  const settlements = await ctx.db
    .query("purchaseSettlements")
    .withIndex("by_pending_checkout", (q) => q.eq("pendingCheckoutId", pendingCheckoutId))
    .collect();

  return await buildSettlementSummary(ctx, settlements);
}

export const getByPaymentIntentId = internalQuery({
  args: { stripePaymentIntentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("creditGrants")
      .withIndex("by_payment_intent", (q) => q.eq("stripePaymentIntentId", args.stripePaymentIntentId))
      .first();
  },
});

export const recordGrant = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    reason: creditGrantReasonValidator,
    stripePaymentIntentId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    // Idempotency: Convex mutations are serialized (ACID, OCC), so the
    // check-then-insert below cannot race — a concurrent call for the same
    // payment intent will block until this mutation commits and will then
    // see the existing row on its own read.
    if (args.stripePaymentIntentId) {
      const existing = await ctx.db
        .query("creditGrants")
        .withIndex("by_payment_intent", (q) => q.eq("stripePaymentIntentId", args.stripePaymentIntentId))
        .first();
      if (existing) {
        return false;
      }
    }

    const applied = await applyCreditsToUser(ctx, args.userId, args.amount);
    if (!applied) {
      return false;
    }

    // Insert audit record
    await ctx.db.insert("creditGrants", {
      userId: args.userId,
      amount: args.amount,
      reason: args.reason,
      stripePaymentIntentId: args.stripePaymentIntentId,
      createdAt: Date.now(),
    });

    return true;
  },
});

export const recordPurchaseSettlement = internalMutation({
  args: {
    userId: v.id("users"),
    priceId: v.string(),
    stripePaymentIntentId: v.string(),
    stripeCheckoutSessionId: v.string(),
    pendingCheckoutId: v.optional(v.id("pendingCheckouts")),
    amountUsd: v.number(),
    currency: v.string(),
  },
  returns: v.object({
    alreadyRecorded: v.boolean(),
    created: v.boolean(),
    creditApplied: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await recordCreditPackPurchaseSettlement(ctx, args);
  },
});

export const recordRefundForPendingCheckout = internalMutation({
  args: {
    pendingCheckoutId: v.id("pendingCheckouts"),
    stripeRefundId: v.string(),
    refundAmountUsd: v.number(),
    refundedAt: v.number(),
  },
  returns: v.object({
    alreadyRefunded: v.boolean(),
    recorded: v.boolean(),
    stripeRefundId: v.optional(v.string()),
    refundAmountUsd: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const settlements = await ctx.db
      .query("purchaseSettlements")
      .withIndex("by_pending_checkout", (q) => q.eq("pendingCheckoutId", args.pendingCheckoutId))
      .collect();

    if (settlements.length === 0) {
      return {
        alreadyRefunded: false,
        recorded: false,
      };
    }

    if (settlements.length > 1) {
      throw new Error(
        "Multiple settlement rows match this pending checkout; refund recording is not authoritative",
      );
    }

    const settlement = settlements[0]!;
    if (settlement.refundedAt) {
      if (settlement.stripeRefundId && settlement.stripeRefundId !== args.stripeRefundId) {
        throw new Error("Settlement was already refunded with a different Stripe refund ID");
      }

      return {
        alreadyRefunded: true,
        recorded: false,
        stripeRefundId: settlement.stripeRefundId ?? args.stripeRefundId,
        refundAmountUsd: settlement.refundAmountUsd ?? args.refundAmountUsd,
      };
    }

    // Only claw back credits on the first refund record; guard against
    // duplicate webhook delivery re-deducting an already-clawed-back balance.
    const user = await ctx.db.get(settlement.userId);
    if (user) {
      const current = user.credits ?? 0;
      // Clamp to zero — the user may have already spent some credits.
      const clawback = Math.min(current, settlement.creditsGranted);
      if (clawback > 0) {
        await ctx.db.patch(settlement.userId, { credits: current - clawback });
      }
    }

    await ctx.db.patch(settlement._id, {
      refundRequestedAt: settlement.refundRequestedAt ?? args.refundedAt,
      refundedAt: args.refundedAt,
      stripeRefundId: args.stripeRefundId,
      refundAmountUsd: args.refundAmountUsd,
    });

    return {
      alreadyRefunded: false,
      recorded: true,
      stripeRefundId: args.stripeRefundId,
      refundAmountUsd: args.refundAmountUsd,
    };
  },
});

export const getSettlementByPaymentIntentId = internalQuery({
  args: { stripePaymentIntentId: v.string() },
  returns: v.union(settlementSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    return await getSettlementSummaryByPaymentIntentId(ctx, args.stripePaymentIntentId);
  },
});

export const getSettlementByPendingCheckoutId = internalQuery({
  args: { pendingCheckoutId: v.id("pendingCheckouts") },
  returns: v.union(settlementSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    return await getSettlementSummaryByPendingCheckoutId(ctx, args.pendingCheckoutId);
  },
});

export const getSettlementByPendingCheckoutForCanaryRunner = internalQuery({
  args: { runnerSecret: v.string(), pendingCheckoutId: v.id("pendingCheckouts") },
  returns: v.union(settlementSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    assertVerificationRunnerSecret(args.runnerSecret);

    const principal = await ctx.db
      .query("canaryPrincipals")
      .withIndex("by_principal_id", (q) => q.eq("principalId", "CANARY_SETTLEMENT"))
      .first();
    if (!principal?.appUserId) {
      return null;
    }

    const checkout = await ctx.db.get(args.pendingCheckoutId);
    if (!checkout || checkout.userId !== principal.appUserId) {
      return null;
    }

    return await getSettlementSummaryByPendingCheckoutId(ctx, args.pendingCheckoutId);
  },
});
