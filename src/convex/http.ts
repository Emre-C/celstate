import { httpRouter } from "convex/server";
import { components, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { registerRoutes } from "@convex-dev/stripe";
import type Stripe from "stripe";
import { authComponent, createAuth } from "./auth.js";

const CREDIT_PACKS: Record<string, number> = {
  [process.env.STRIPE_PRICE_STARTER!]: 15,
  [process.env.STRIPE_PRICE_PRO!]: 40,
};

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

registerRoutes(http, components.stripe, {
  events: {
    "checkout.session.completed": async (ctx, event: Stripe.CheckoutSessionCompletedEvent) => {
      const session = event.data.object;
      const paymentIntentId = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;

      if (!paymentIntentId) {
        console.error("No payment_intent on checkout session", session.id);
        return;
      }

      const priceId = session.metadata?.priceId;
      const credits = priceId ? CREDIT_PACKS[priceId] : undefined;
      if (!credits) {
        console.error("Unknown priceId or no credits mapping", priceId, session.id);
        return;
      }

      const userId = session.metadata?.userId;
      if (!userId) {
        console.error("No userId metadata on checkout session", session.id);
        return;
      }

      // Idempotency: check if we've already granted credits for this paymentIntentId
      const existing = await ctx.runQuery(
        internal.creditGrants.getByPaymentIntentId,
        { stripePaymentIntentId: paymentIntentId },
      );
      if (existing) {
        console.log("Credits already granted for", paymentIntentId);
        return;
      }

      // Grant credits and record audit trail
      await ctx.runMutation(internal.creditGrants.recordGrant, {
        userId: userId as Id<"users">,
        amount: credits,
        reason: "purchase",
        stripePaymentIntentId: paymentIntentId,
      });
    },
  },
});

export default http;
