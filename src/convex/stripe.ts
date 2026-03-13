"use node";

import { v } from "convex/values";
import { authComponent } from "./auth.js";
import { action } from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";
import { StripeSubscriptions } from "@convex-dev/stripe";

const stripeClient = new StripeSubscriptions(components.stripe, {});

export const createPaymentCheckout = action({
  args: { priceId: v.string() },
  returns: v.object({
    sessionId: v.string(),
    url: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args): Promise<{ sessionId: string; url: string | null }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("Authenticated user record not found");
    }

    let appUser: {
      _id: string;
      email?: string;
      name?: string;
      image?: string;
    } | null = await ctx.runQuery(internal.users.getByTokenIdentifier, {
      tokenIdentifier: identity.tokenIdentifier,
    });

    if (!appUser) {
      await ctx.runMutation(internal.users.upsertByTokenIdentifier, {
        tokenIdentifier: identity.tokenIdentifier,
        email: authUser.email,
        name: authUser.name,
        image: authUser.image ?? undefined,
      });

      appUser = await ctx.runQuery(internal.users.getByTokenIdentifier, {
        tokenIdentifier: identity.tokenIdentifier,
      });
    }

    if (!appUser) {
      throw new Error("User profile not initialized");
    }

    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: String(appUser._id),
      email: appUser.email ?? authUser.email,
      name: appUser.name ?? authUser.name,
    });

    const hostingUrl = process.env.SITE_URL ?? "http://localhost:5173";
    const userId: string = String(appUser._id);

    return await stripeClient.createCheckoutSession(ctx, {
      priceId: args.priceId,
      customerId: customer.customerId,
      mode: "payment",
      successUrl: `${hostingUrl}/app?success=true`,
      cancelUrl: `${hostingUrl}/app?canceled=true`,
      paymentIntentMetadata: { priceId: args.priceId, userId },
      metadata: { priceId: args.priceId, userId },
    });
  },
});
