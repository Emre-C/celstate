"use node";

import { v } from "convex/values";
import { authComponent } from "./auth.js";
import { internalAction } from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";
import { StripeSubscriptions } from "@convex-dev/stripe";
import { assertStripeEnv } from "./lib/stripeEnv.js";

const stripeClient = new StripeSubscriptions(components.stripe, {});

export const processCheckout = internalAction({
  args: {
    checkoutId: v.id("pendingCheckouts"),
    userId: v.id("users"),
    priceId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    cachedStripeCustomerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const stripeEnv = assertStripeEnv();
      const userIdStr = String(args.userId);

      let customerId = args.cachedStripeCustomerId;

      if (!customerId) {
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

      const result = await stripeClient.createCheckoutSession(ctx, {
        priceId: args.priceId,
        customerId,
        mode: "payment",
        successUrl: `${stripeEnv.siteUrl}/app?success=true`,
        cancelUrl: `${stripeEnv.siteUrl}/app?canceled=true`,
        paymentIntentMetadata: { priceId: args.priceId, userId: userIdStr },
        metadata: { priceId: args.priceId, userId: userIdStr },
      });

      await ctx.runMutation(internal.pendingCheckouts.markReady, {
        checkoutId: args.checkoutId,
        checkoutUrl: result.url ?? "",
      });
    } catch (e) {
      await ctx.runMutation(internal.pendingCheckouts.markFailed, {
        checkoutId: args.checkoutId,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  },
});
