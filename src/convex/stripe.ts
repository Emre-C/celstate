"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";
import { StripeSubscriptions } from "@convex-dev/stripe";
import Stripe from "stripe";
import {
  buildCreditPackCheckoutSessionIdempotencyKey,
  buildStripeCheckoutSessionCreateParams,
} from "./lib/stripeCheckout.js";

const stripeClient = new StripeSubscriptions(components.stripe, {});

/**
 * Drives a single pending credit-pack checkout through Stripe.
 *
 * Durability contract:
 *   1. Acquire an atomic processing lease via `claimCheckoutForProcessing`
 *      before doing ANY Stripe side effect. If another invocation is
 *      mid-flight (lease still held) or has already finished (status moved
 *      off "pending"), this invocation exits without touching Stripe.
 *      That prevents concurrent/replayed actions from racing the same
 *      pendingCheckout while the lease is live.
 *
 *   2. Stripe customer creation goes through `getOrCreateCustomer`, which
 *      is itself idempotent on `userId` and tolerates being called twice
 *      across action retries.
 *
 *   3. Stripe Checkout Session creation uses an idempotency key derived from
 *      pendingCheckoutId. If Stripe created a session but the action crashed
 *      before `markReady`, a later lease owner replays the same POST without
 *      creating a second hosted Checkout Session.
 *
 *   4. On success or failure, transition the row through
 *      `markReady`/`markFailed`. Both mutations refuse to touch the row
 *      unless it is still "pending" and the caller still owns the current
 *      processing lease. A timed-out action cannot clobber a newer owner.
 *
 *   5. If we acquired the lease but the Stripe call itself crashed before
 *      we observed a result, the lease is cleared by `markFailed`. If we
 *      crash after Stripe returned but before `markReady` lands, the lease
 *      will time out (`CREDIT_PACK_CHECKOUT_PROCESSING_LEASE_MS`) and a
 *      future invocation can resume — but only by acquiring the lease
 *      again, never by overwriting a row that is no longer pending.
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
  handler: async (ctx, args) => {
    const claim = await ctx.runMutation(
      internal.pendingCheckouts.claimCheckoutForProcessing,
      { checkoutId: args.checkoutId },
    );

    if (!claim.ok) {
      // Already terminal, missing, or another invocation is mid-flight.
      // Surface the reason so it is visible in Convex logs but never call
      // Stripe a second time. Each branch is intentionally a no-op; the
      // already-running invocation owns the terminal transition.
      console.info(
        JSON.stringify({
          event: "process_checkout_claim_skipped",
          checkoutId: String(args.checkoutId),
          reason: claim.reason,
          existingSessionId: claim.existingSessionId,
        }),
      );
      return;
    }

    let stripeCallStarted = false;
    try {
      const userIdStr = String(args.userId);
      let customerId = args.cachedStripeCustomerId;

      if (!customerId) {
        if (args.requireExistingStripeCustomerId) {
          throw new Error(
            "Checkout requires an existing Stripe customer with a saved payment method",
          );
        }

        const customer = await stripeClient.getOrCreateCustomer(ctx, {
          userId: userIdStr,
          email: args.email,
          name: args.name,
        });
        customerId = customer.customerId;

        await ctx.runMutation(internal.pendingCheckouts.cacheStripeCustomerId, {
          userId: args.userId,
          stripeCustomerId: customerId,
        });
      }

      stripeCallStarted = true;
      const stripe = new Stripe(stripeClient.apiKey);
      const result = await stripe.checkout.sessions.create(
        buildStripeCheckoutSessionCreateParams({
          customerId,
          priceId: args.priceId,
          userId: args.userId,
        }),
        {
          idempotencyKey: buildCreditPackCheckoutSessionIdempotencyKey(args.checkoutId),
        },
      );

      await ctx.runMutation(internal.pendingCheckouts.markReady, {
        checkoutId: args.checkoutId,
        checkoutUrl: result.url ?? "",
        leaseId: claim.leaseId,
        stripeCheckoutSessionId: result.id,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      console.error(
        JSON.stringify({
          event: "process_checkout_failed",
          checkoutId: String(args.checkoutId),
          stripeCallStarted,
          message,
        }),
      );
      // markFailed is conditional on status === "pending"; if a sibling
      // invocation already raced ahead of us and recorded "ready", this
      // becomes a no-op and the successful state is preserved.
      await ctx.runMutation(internal.pendingCheckouts.markFailed, {
        checkoutId: args.checkoutId,
        error: message,
        leaseId: claim.leaseId,
      });
    }
  },
});
