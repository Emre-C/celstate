import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { upsertCurrentUser, getCurrentAppUser } from "./users.js";
import {
  CREDIT_PACK_CHECKOUT_PROCESSING_LEASE_MS,
  type CreditPackProcessingClaim,
  getKnownCreditPackPriceIds,
  requestCreditPackCheckout,
  toCreditPackCheckoutStatus,
} from "./lib/stripeCheckout.js";
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

async function assertNoActiveSettlementCanary(ctx: MutationCtx, userId: Id<"users">) {
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

async function getCanaryCheckoutStatus(
  ctx: QueryCtx,
  args: {
    checkoutId: Id<"pendingCheckouts">;
    runnerSecret: string;
  },
  principalId: "CANARY_CHECKOUT" | "CANARY_SETTLEMENT",
) {
  assertVerificationRunnerSecret(args.runnerSecret);
  const { principal } = await getProvisionedCanaryUser(ctx, principalId);

  const checkout = await ctx.db.get(args.checkoutId);
  if (!checkout || checkout.userId !== principal.appUserId) {
    return null;
  }

  return toCreditPackCheckoutStatus(checkout);
}

export const requestCheckout = mutation({
  args: { priceId: v.string() },
  returns: v.id("pendingCheckouts"),
  handler: async (ctx, args) => {
    const user = await upsertCurrentUser(ctx);

    return await requestCreditPackCheckout(ctx, {
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

    return await requestCreditPackCheckout(ctx, {
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

    if (!user.stripeCustomerId) {
      throw new ConvexError(
        "CANARY_SETTLEMENT requires an existing Stripe customer with a saved payment method",
      );
    }

    return await requestCreditPackCheckout(ctx, {
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
    return await getCanaryCheckoutStatus(ctx, args, "CANARY_CHECKOUT");
  },
});

export const getSettlementCheckoutStatusForCanaryRunner = internalQuery({
  args: {
    runnerSecret: v.string(),
    checkoutId: v.id("pendingCheckouts"),
  },
  returns: canaryCheckoutStatusValidator,
  handler: async (ctx, args) => {
    return await getCanaryCheckoutStatus(ctx, args, "CANARY_SETTLEMENT");
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

    const status = toCreditPackCheckoutStatus(checkout);

    if (status.status === "ready") {
      return { status: "ready" as const, checkoutUrl: status.checkoutUrl };
    }

    if (status.status === "failed") {
      return { status: "failed" as const, error: status.error };
    }

    return { status: "pending" as const };
  },
});

/**
 * Atomic compare-and-set claim that gates the side-effectful Stripe call in
 * `processCheckout`. Returns `{ ok: true }` only when this caller now owns
 * the processing lease for this pending checkout. Concurrent or replayed
 * action invocations get `ok: false` with a structured reason and (when
 * applicable) the already-stored Stripe session id so the caller can avoid
 * creating a duplicate Stripe Checkout Session.
 *
 * The lease is bounded by `CREDIT_PACK_CHECKOUT_PROCESSING_LEASE_MS`, after
 * which a stale lease (e.g. an action that was killed mid-flight) may be
 * reclaimed. Successful and failed terminal mutations clear the lease.
 */
export const claimCheckoutForProcessing = internalMutation({
  args: {
    checkoutId: v.id("pendingCheckouts"),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), leaseId: v.string() }),
    v.object({
      ok: v.literal(false),
      reason: v.union(
        v.literal("not_pending"),
        v.literal("lease_held"),
        v.literal("missing"),
      ),
      existingSessionId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args): Promise<CreditPackProcessingClaim> => {
    const checkout = await ctx.db.get(args.checkoutId);
    if (!checkout) {
      return { ok: false, reason: "missing" };
    }

    if (checkout.status !== "pending") {
      return {
        ok: false,
        reason: "not_pending",
        existingSessionId: checkout.stripeCheckoutSessionId ?? undefined,
      };
    }

    const now = Date.now();
    const leaseDeadline = (checkout.processingStartedAt ?? 0) + CREDIT_PACK_CHECKOUT_PROCESSING_LEASE_MS;
    if (checkout.processingStartedAt && leaseDeadline > now) {
      return {
        ok: false,
        reason: "lease_held",
        existingSessionId: checkout.stripeCheckoutSessionId ?? undefined,
      };
    }

    const leaseId = crypto.randomUUID();
    await ctx.db.patch(args.checkoutId, {
      processingLeaseId: leaseId,
      processingStartedAt: now,
    });
    return { ok: true, leaseId };
  },
});

export const markReady = internalMutation({
  args: {
    checkoutId: v.id("pendingCheckouts"),
    checkoutUrl: v.string(),
    leaseId: v.string(),
    stripeCheckoutSessionId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const checkout = await ctx.db.get(args.checkoutId);
    // Only the still-pending row may be promoted to ready. A late or replayed
    // success path must never clobber a row that has already been marked
    // failed (or, defensively, already ready) — that would lose the canonical
    // stripeCheckoutSessionId we use for refund/canary/audit correlation.
    // The lease owner check prevents an action whose timed-out lease was
    // reclaimed from promoting the row after a newer invocation took over.
    if (!checkout || checkout.status !== "pending" || checkout.processingLeaseId !== args.leaseId) {
      return null;
    }

    await ctx.db.patch(args.checkoutId, {
      status: "ready",
      checkoutUrl: args.checkoutUrl,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      processingLeaseId: undefined,
      processingStartedAt: undefined,
    });
    return null;
  },
});

export const markFailed = internalMutation({
  args: {
    checkoutId: v.id("pendingCheckouts"),
    error: v.string(),
    leaseId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const checkout = await ctx.db.get(args.checkoutId);
    // Only the still-pending row may be marked failed. A late failure (e.g.
    // an exception from the Stripe call after another invocation already
    // created the session and recorded it as ready) must not clobber a
    // successful state — that is the bug the architectural review flagged.
    // The lease owner check additionally prevents a timed-out action from
    // failing the row after a newer invocation has reclaimed processing.
    if (!checkout || checkout.status !== "pending" || checkout.processingLeaseId !== args.leaseId) {
      return null;
    }

    await ctx.db.patch(args.checkoutId, {
      status: "failed",
      error: args.error,
      processingLeaseId: undefined,
      processingStartedAt: undefined,
    });
    return null;
  },
});

/**
 * Releases a held lease without changing the row's status. Used by
 * `processCheckout` when the action wants to bow out without recording a
 * terminal state (e.g. it discovered another invocation already produced
 * the Stripe session). Idempotent.
 */
export const releaseCheckoutProcessingLease = internalMutation({
  args: {
    checkoutId: v.id("pendingCheckouts"),
    leaseId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const checkout = await ctx.db.get(args.checkoutId);
    if (!checkout || checkout.processingLeaseId !== args.leaseId) {
      return null;
    }

    await ctx.db.patch(args.checkoutId, {
      processingLeaseId: undefined,
      processingStartedAt: undefined,
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
