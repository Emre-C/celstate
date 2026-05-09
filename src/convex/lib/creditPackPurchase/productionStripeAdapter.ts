"use node";

import Stripe from "stripe";
import { StripeSubscriptions } from "@convex-dev/stripe";
import { components } from "../../_generated/api.js";
import type { ActionCtx } from "../../_generated/server.js";
import type { CreditPackStripePort } from "./stripePort.js";

/**
 * Production Stripe port. Threads `getOrCreateCustomer` through
 * `@convex-dev/stripe`'s `StripeSubscriptions` component (which already
 * provides idempotent customer creation with internal user-id mapping),
 * and uses the raw Stripe SDK for `createCheckoutSession` / `createRefund`
 * because those need explicit per-call `idempotencyKey` headers that the
 * component does not currently expose.
 */
export function createProductionStripePort(
  ctx: ActionCtx,
): CreditPackStripePort {
  const stripeSubs = new StripeSubscriptions(components.stripe, {});
  const stripe = new Stripe(stripeSubs.apiKey);

  return {
    async getOrCreateCustomer({ userId, email, name }) {
      const customer = await stripeSubs.getOrCreateCustomer(ctx, {
        userId,
        email,
        name,
      });
      return { customerId: customer.customerId };
    },

    async createCheckoutSession({ params, idempotencyKey }) {
      const session = await stripe.checkout.sessions.create(params, {
        idempotencyKey,
      });
      return { id: session.id, url: session.url };
    },

    async createRefund({ paymentIntentId, idempotencyKey }) {
      const refund = await stripe.refunds.create(
        { payment_intent: paymentIntentId },
        { idempotencyKey },
      );
      return {
        id: refund.id,
        amountCents: typeof refund.amount === "number" ? refund.amount : 0,
      };
    },
  };
}
