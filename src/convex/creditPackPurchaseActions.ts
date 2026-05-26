"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { createProductionStripePort } from "./lib/creditPackPurchase/productionStripeAdapter.js";
import {
  runProcessCheckout,
  runRefundCheckoutForCanary,
  type RecordRefundOutcome,
  type RefundCanaryResult,
  type SettlementSummary,
} from "./lib/creditPackPurchase/lifecycle.js";
import { assertVerificationRunnerSecret } from "./lib/verification/verificationRunnerSecret.js";

/**
 * Node-runtime side of the credit-pack purchase module. Houses the only
 * code paths that need the Stripe SDK (`getOrCreateCustomer`,
 * `checkout.sessions.create`, `refunds.create`). All durability and
 * idempotency logic lives in `lib/creditPackPurchase/lifecycle.ts` —
 * this file is a thin glue layer that wires the production Stripe port
 * (`productionStripeAdapter.ts`) and the V8 mutation/query callables
 * (`creditPackPurchase.ts`) into the lifecycle action runners.
 *
 * Tests exercise the same `runProcessCheckout` / `runRefundCheckoutForCanary`
 * runners directly with the in-memory port and a `t.mutation`-backed
 * runner; this file is deliberately untested because it has zero branching.
 */

export const processCheckout = internalAction({
  args: {
    checkoutId: v.id("pendingCheckouts"),
    userId: v.id("users"),
    priceId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    cachedStripeCustomerId: v.optional(v.string()),
    requireExistingStripeCustomerId: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const port = createProductionStripePort(ctx);

    await runProcessCheckout(
      {
        claim: (claimArgs) =>
          ctx.runMutation(
            internal.creditPackPurchase.claimCheckoutForProcessing,
            claimArgs,
          ),
        cacheCustomer: async (cacheArgs) => {
          await ctx.runMutation(
            internal.creditPackPurchase.cacheStripeCustomerId,
            cacheArgs,
          );
        },
        markReady: async (markReadyArgs) => {
          await ctx.runMutation(
            internal.creditPackPurchase.markReady,
            markReadyArgs,
          );
        },
        markFailed: async (markFailedArgs) => {
          await ctx.runMutation(
            internal.creditPackPurchase.markFailed,
            markFailedArgs,
          );
        },
      },
      port,
      args,
    );
    return null;
  },
});

export const refundCheckoutForCanary = internalAction({
  args: {
    runnerSecret: v.string(),
    pendingCheckoutId: v.id("pendingCheckouts"),
  },
  returns: v.object({
    stripeRefundId: v.string(),
    refundAmountUsd: v.number(),
    alreadyRefunded: v.boolean(),
  }),
  handler: async (ctx, args): Promise<RefundCanaryResult> => {
    assertVerificationRunnerSecret(args.runnerSecret);
    const port = createProductionStripePort(ctx);

    return await runRefundCheckoutForCanary(
      {
        getSettlement: async (getArgs): Promise<SettlementSummary | null> =>
          await ctx.runQuery(
            internal.creditPackPurchase
              .getSettlementByPendingCheckoutForCanaryRunner,
            {
              runnerSecret: args.runnerSecret,
              pendingCheckoutId: getArgs.pendingCheckoutId,
            },
          ),
        recordRefund: async (recordArgs): Promise<RecordRefundOutcome> =>
          await ctx.runMutation(
            internal.creditPackPurchase.recordRefundForCanary,
            {
              runnerSecret: args.runnerSecret,
              ...recordArgs,
            },
          ),
      },
      port,
      args,
    );
  },
});
