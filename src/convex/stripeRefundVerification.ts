"use node";

import Stripe from "stripe";
import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { assertStripeEnv } from "./lib/stripeEnv.js";
import { assertVerificationRunnerSecret } from "./lib/verificationRunnerSecret.js";

/**
 * Refund a canary settlement by its pendingCheckoutId.
 *
 * Safety constraints vs the old refundStripePaymentIntentForCanary:
 *   - Only acts on settlements linked to a verified CANARY_SETTLEMENT checkout
 *   - Uses a Stripe idempotency key derived from pendingCheckoutId
 *   - Returns early (alreadyRefunded) if the settlement is already refunded
 */
export const refundSettlementByPendingCheckoutForCanary = internalAction({
  args: {
    runnerSecret: v.string(),
    pendingCheckoutId: v.id("pendingCheckouts"),
  },
  returns: v.object({
    stripeRefundId: v.string(),
    refundAmountUsd: v.number(),
    alreadyRefunded: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{
    stripeRefundId: string;
    refundAmountUsd: number;
    alreadyRefunded: boolean;
  }> => {
    assertVerificationRunnerSecret(args.runnerSecret);

    const settlement: {
      stripePaymentIntentId: string;
      refundedAt?: number;
      stripeRefundId?: string;
      refundAmountUsd?: number;
    } | null = await ctx.runQuery(
      internal.creditGrants.getSettlementByPendingCheckoutForCanaryRunner,
      { runnerSecret: args.runnerSecret, pendingCheckoutId: args.pendingCheckoutId },
    );

    if (!settlement) {
      throw new Error(
        "No settlement found for this pending checkout, or checkout does not belong to CANARY_SETTLEMENT",
      );
    }

    if (settlement.refundedAt) {
      return {
        stripeRefundId: settlement.stripeRefundId ?? "unknown",
        refundAmountUsd: settlement.refundAmountUsd ?? 0,
        alreadyRefunded: true,
      };
    }

    const stripeEnv = assertStripeEnv();
    const stripe = new Stripe(stripeEnv.stripeSecretKey);

    const refund = await stripe.refunds.create(
      { payment_intent: settlement.stripePaymentIntentId },
      { idempotencyKey: `canary-refund-${args.pendingCheckoutId}` },
    );

    const amountCents = typeof refund.amount === "number" ? refund.amount : 0;
    const refundAmountUsd = amountCents / 100;

    await ctx.runMutation(internal.creditGrants.recordRefundForPendingCheckout, {
      pendingCheckoutId: args.pendingCheckoutId,
      stripeRefundId: refund.id,
      refundAmountUsd,
      refundedAt: Date.now(),
    });

    return { stripeRefundId: refund.id, refundAmountUsd, alreadyRefunded: false };
  },
});
