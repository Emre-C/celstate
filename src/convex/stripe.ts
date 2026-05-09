"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";

/**
 * Legacy entry point: in-flight scheduled jobs or older call sites may still
 * reference `internal.stripe.processCheckout`. Forwards to the credit-pack
 * purchase module action (Stripe SDK + lease semantics live there).
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
    await ctx.runAction(internal.creditPackPurchaseActions.processCheckout, args);
    return null;
  },
});
