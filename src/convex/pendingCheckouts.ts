import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { upsertCurrentUser, getCurrentAppUser } from "./users.js";
import { assertStripeEnv } from "./lib/stripeEnv.js";
import { isKnownCreditPackPriceId } from "./lib/stripeCheckout.js";
import { assertVerificationRunnerSecret } from "./lib/verificationRunnerSecret.js";

const CHECKOUT_SESSION_EXPIRY_MS = 26 * 60 * 60 * 1000;

const canaryCheckoutStatusValidator = v.union(
  v.object({
    status: v.literal("pending"),
  }),
  v.object({
    status: v.literal("ready"),
    checkoutUrl: v.string(),
    stripeCheckoutSessionId: v.optional(v.string()),
  }),
  v.object({
    status: v.literal("failed"),
    error: v.string(),
  }),
  v.null(),
);

const getKnownCreditPackPriceIds = () => {
  const stripeEnv = assertStripeEnv();

  return {
    starter: stripeEnv.stripePriceStarter,
    pro: stripeEnv.stripePricePro,
  };
};

async function requestCheckoutCore(
  ctx: MutationCtx,
  args: {
    cachedStripeCustomerId?: string;
    email?: string;
    name?: string;
    priceId: string;
    requireExistingStripeCustomerId?: boolean;
    userId: any;
  },
) {
  const checkoutId = await ctx.db.insert("pendingCheckouts", {
    userId: args.userId,
    priceId: args.priceId,
    status: "pending",
    createdAt: Date.now(),
  });

  await ctx.scheduler.runAfter(0, internal.stripe.processCheckout, {
    checkoutId,
    userId: args.userId,
    priceId: args.priceId,
    email: args.email,
    name: args.name,
    cachedStripeCustomerId: args.cachedStripeCustomerId,
    requireExistingStripeCustomerId: args.requireExistingStripeCustomerId,
  });

  return checkoutId;
}

async function getProvisionedCanaryUser(
  ctx: Pick<QueryCtx, "db">,
  principalId: "CANARY_CHECKOUT" | "CANARY_SETTLEMENT",
) {
  const principal = await ctx.db
    .query("canaryPrincipals")
    .withIndex("by_principal_id", (q) => q.eq("principalId", principalId))
    .first();
  if (!principal?.appUserId) {
    throw new ConvexError(`${principalId} is not provisioned (missing canaryPrincipals row or appUserId)`);
  }

  const user = await ctx.db.get(principal.appUserId);
  if (!user) {
    throw new ConvexError(`${principalId} app user no longer exists`);
  }

  return { principal, user };
}

async function assertNoActiveSettlementCanary(ctx: MutationCtx, userId: any) {
  const pendingCheckouts = await ctx.db
    .query("pendingCheckouts")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "pending"))
    .collect();

  if (pendingCheckouts.length > 0) {
    throw new ConvexError(
      "CANARY_SETTLEMENT already has a pending destructive checkout; resolve the existing run before starting another",
    );
  }

  const readyCheckouts = await ctx.db
    .query("pendingCheckouts")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "ready"))
    .collect();

  const readyCutoff = Date.now() - CHECKOUT_SESSION_EXPIRY_MS;
  for (const checkout of readyCheckouts) {
    const settlement = await ctx.db
      .query("purchaseSettlements")
      .withIndex("by_pending_checkout", (q) => q.eq("pendingCheckoutId", checkout._id))
      .first();

    if (!settlement) {
      if (checkout.createdAt >= readyCutoff) {
        throw new ConvexError(
          "CANARY_SETTLEMENT already has a live hosted checkout awaiting payment or settlement observation",
        );
      }
      continue;
    }

    if (!settlement.refundedAt) {
      throw new ConvexError(
        "CANARY_SETTLEMENT has an unresolved paid checkout awaiting refund reconciliation",
      );
    }
  }
}

function toCheckoutStatus(checkout: {
  checkoutUrl?: string;
  error?: string;
  status: "pending" | "ready" | "failed";
  stripeCheckoutSessionId?: string;
}) {
  if (checkout.status === "ready") {
    return {
      status: "ready" as const,
      checkoutUrl: checkout.checkoutUrl ?? "",
      stripeCheckoutSessionId: checkout.stripeCheckoutSessionId,
    };
  }
  if (checkout.status === "failed") {
    return { status: "failed" as const, error: checkout.error ?? "Unknown error" };
  }
  return { status: "pending" as const };
}

export const requestCheckout = mutation({
  args: { priceId: v.string() },
  returns: v.id("pendingCheckouts"),
  handler: async (ctx, args) => {
    if (!isKnownCreditPackPriceId(args.priceId, getKnownCreditPackPriceIds())) {
      throw new ConvexError("Invalid credit pack");
    }

    const user = await upsertCurrentUser(ctx);

    return await requestCheckoutCore(ctx, {
      userId: user._id,
      priceId: args.priceId,
      email: user.email,
      name: user.name,
      cachedStripeCustomerId: user.stripeCustomerId,
    });
  },
});

export const requestCheckoutForCanaryRunner = internalMutation({
  args: {
    runnerSecret: v.string(),
    priceId: v.optional(v.string()),
  },
  returns: v.id("pendingCheckouts"),
  handler: async (ctx, args) => {
    assertVerificationRunnerSecret(args.runnerSecret);
    const { user } = await getProvisionedCanaryUser(ctx, "CANARY_CHECKOUT");

    const known = getKnownCreditPackPriceIds();
    const priceId = args.priceId ?? known.starter;
    if (!isKnownCreditPackPriceId(priceId, known)) {
      throw new ConvexError("Invalid credit pack");
    }

    return await requestCheckoutCore(ctx, {
      userId: user._id,
      priceId,
      email: user.email,
      name: user.name,
      cachedStripeCustomerId: user.stripeCustomerId,
    });
  },
});

export const requestSettlementCheckoutForCanaryRunner = internalMutation({
  args: {
    runnerSecret: v.string(),
    priceId: v.optional(v.string()),
  },
  returns: v.id("pendingCheckouts"),
  handler: async (ctx, args) => {
    assertVerificationRunnerSecret(args.runnerSecret);
    const { user } = await getProvisionedCanaryUser(ctx, "CANARY_SETTLEMENT");
    await assertNoActiveSettlementCanary(ctx, user._id);

    const known = getKnownCreditPackPriceIds();
    const priceId = args.priceId ?? known.starter;
    if (!isKnownCreditPackPriceId(priceId, known)) {
      throw new ConvexError("Invalid credit pack");
    }

    if (!user.stripeCustomerId) {
      throw new ConvexError(
        "CANARY_SETTLEMENT requires an existing Stripe customer with a saved payment method",
      );
    }

    return await requestCheckoutCore(ctx, {
      userId: user._id,
      priceId,
      email: user.email,
      name: user.name,
      cachedStripeCustomerId: user.stripeCustomerId,
      requireExistingStripeCustomerId: true,
    });
  },
});

export const getCheckoutStatusForCanaryRunner = internalQuery({
  args: {
    runnerSecret: v.string(),
    checkoutId: v.id("pendingCheckouts"),
  },
  returns: canaryCheckoutStatusValidator,
  handler: async (ctx, args) => {
    assertVerificationRunnerSecret(args.runnerSecret);
    const { principal } = await getProvisionedCanaryUser(ctx, "CANARY_CHECKOUT");

    const checkout = await ctx.db.get(args.checkoutId);
    if (!checkout || checkout.userId !== principal.appUserId) {
      return null;
    }

    return toCheckoutStatus(checkout);
  },
});

export const getSettlementCheckoutStatusForCanaryRunner = internalQuery({
  args: {
    runnerSecret: v.string(),
    checkoutId: v.id("pendingCheckouts"),
  },
  returns: canaryCheckoutStatusValidator,
  handler: async (ctx, args) => {
    assertVerificationRunnerSecret(args.runnerSecret);
    const { principal } = await getProvisionedCanaryUser(ctx, "CANARY_SETTLEMENT");

    const checkout = await ctx.db.get(args.checkoutId);
    if (!checkout || checkout.userId !== principal.appUserId) {
      return null;
    }

    return toCheckoutStatus(checkout);
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
    stripeCheckoutSessionId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.checkoutId, {
      status: "ready",
      checkoutUrl: args.checkoutUrl,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
    });
    return null;
  },
});

export const markFailed = internalMutation({
  args: {
    checkoutId: v.id("pendingCheckouts"),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.checkoutId, {
      status: "failed",
      error: args.error,
    });
    return null;
  },
});

export const cacheStripeCustomerId = internalMutation({
  args: {
    userId: v.id("users"),
    stripeCustomerId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      stripeCustomerId: args.stripeCustomerId,
    });
    return null;
  },
});

export const getByStripeCheckoutSessionId = internalQuery({
  args: { stripeCheckoutSessionId: v.string() },
  returns: v.union(v.id("pendingCheckouts"), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("pendingCheckouts")
      .withIndex("by_stripe_checkout_session", (q) =>
        q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId),
      )
      .first();
    return row?._id ?? null;
  },
});
