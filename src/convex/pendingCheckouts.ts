import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { upsertCurrentUser, getCurrentAppUser } from "./users.js";
import { assertStripeEnv } from "./lib/stripeEnv.js";
import { isKnownCreditPackPriceId } from "./lib/stripeCheckout.js";

const getKnownCreditPackPriceIds = () => {
  const stripeEnv = assertStripeEnv();

  return {
    starter: stripeEnv.stripePriceStarter,
    pro: stripeEnv.stripePricePro,
  };
};

export const requestCheckout = mutation({
  args: { priceId: v.string() },
  returns: v.id("pendingCheckouts"),
  handler: async (ctx, args) => {
    if (!isKnownCreditPackPriceId(args.priceId, getKnownCreditPackPriceIds())) {
      throw new ConvexError("Invalid credit pack");
    }

    const user = await upsertCurrentUser(ctx);

    const checkoutId = await ctx.db.insert("pendingCheckouts", {
      userId: user._id,
      priceId: args.priceId,
      status: "pending",
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.stripe.processCheckout, {
      checkoutId,
      userId: user._id,
      priceId: args.priceId,
      email: user.email,
      name: user.name,
      cachedStripeCustomerId: user.stripeCustomerId,
    });

    return checkoutId;
  },
});

export const getCheckoutStatus = query({
  args: { checkoutId: v.id("pendingCheckouts") },
  returns: v.union(
    v.object({
      status: v.literal("pending"),
    }),
    v.object({
      status: v.literal("ready"),
      checkoutUrl: v.string(),
    }),
    v.object({
      status: v.literal("failed"),
      error: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const appUser = await getCurrentAppUser(ctx);
    if (!appUser) return null;

    const checkout = await ctx.db.get(args.checkoutId);
    if (!checkout || checkout.userId !== appUser._id) return null;

    if (checkout.status === "ready") {
      return { status: "ready" as const, checkoutUrl: checkout.checkoutUrl ?? "" };
    }
    if (checkout.status === "failed") {
      return { status: "failed" as const, error: checkout.error ?? "Unknown error" };
    }
    return { status: "pending" as const };
  },
});

export const markReady = internalMutation({
  args: {
    checkoutId: v.id("pendingCheckouts"),
    checkoutUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.checkoutId, {
      status: "ready",
      checkoutUrl: args.checkoutUrl,
    });
  },
});

export const markFailed = internalMutation({
  args: {
    checkoutId: v.id("pendingCheckouts"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.checkoutId, {
      status: "failed",
      error: args.error,
    });
  },
});

export const cacheStripeCustomerId = internalMutation({
  args: {
    userId: v.id("users"),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      stripeCustomerId: args.stripeCustomerId,
    });
  },
});
