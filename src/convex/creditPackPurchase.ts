import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { upsertCurrentUser, getCurrentAppUser } from "./users.js";
import { assertVerificationRunnerSecret } from "./lib/verification/verificationRunnerSecret.js";
import { getKnownCreditPackPriceIds } from "./lib/creditPackPurchase/catalog.js";
import {
  cacheStripeCustomerIdHelper,
  claimCheckoutForProcessingHelper,
  getCheckoutByStripeSessionId,
  getCreditPackSettlementCandidate,
  getSettlementSummaryByPaymentIntent,
  getSettlementSummaryByPendingCheckout,
  markCheckoutFailedHelper,
  markCheckoutReadyHelper,
  normalizeStripeCheckoutSessionWebhookPayload,
  parseChargeRefundedWebhookPayload,
  parseRefundCreatedWebhookPayload,
  purgeUserPurchaseStateHelper,
  recordPurchaseSettlementHelper,
  recordRefundForPaymentIntentHelper,
  recordRefundForPendingCheckoutHelper,
  releaseCheckoutProcessingLeaseHelper,
  requestCreditPackCheckoutHelper,
  toCreditPackCheckoutStatus,
  type RecordPurchaseSettlementOutcome,
  type RecordRefundOutcome,
  type SettlementSummary,
} from "./lib/creditPackPurchase/lifecycle.js";

/**
 * Module entry-point for the deepened credit-pack purchase lifecycle.
 *
 * Public surface:
 *   - `requestCheckout` — current-user mutation that creates a pending
 *     checkout and schedules the Stripe action.
 *   - `getCheckoutStatus` — current-user query for the post-redirect /app/credits
 *     polling loop.
 *
 * Internal surface (called by `http.ts`, the Stripe action, the canary
 * runner, and `qaUserReset`):
 *   - Lease/lifecycle helpers used by the action runtime
 *     (`claimCheckoutForProcessing`, `markReady`, `markFailed`,
 *     `releaseCheckoutProcessingLease`, `cacheStripeCustomerId`,
 *     `getByStripeCheckoutSessionId`).
 *   - Webhook entry points (`onStripeCheckoutCompleted`,
 *     `onStripeChargeRefunded`, `onStripeRefundCreated`) — accept raw Stripe
 *     payloads (`v.any()` at Convex boundary); parsing is normalized in
 *     `lifecycle.ts`. Prefer a single refund event in `http.ts` (typically
 *     `refund.created` on modern Stripe webhook API versions).
 *   - Settlement queries (`getSettlementByPaymentIntentId`,
 *     `getSettlementByPendingCheckoutId`).
 *   - Canary runner entry points
 *     (`requestCheckoutForCanaryRunner`, `requestSettlementCheckoutForCanaryRunner`,
 *     `getCheckoutStatusForCanaryRunner`, `getSettlementCheckoutStatusForCanaryRunner`,
 *     `getSettlementByPendingCheckoutForCanaryRunner`,
 *     `recordRefundForCanary`).
 *   - QA purge wrapper (`purgeUserPurchaseStateForQa`).
 *
 * Production-only side effects (PostHog `revenue` events, Discord ops
 * alerts on grant skip) live in `http.ts`. Mutations here return a
 * structured outcome the caller reacts to.
 */

const CHECKOUT_SESSION_EXPIRY_MS = 26 * 60 * 60 * 1000;

const canaryCheckoutStatusValidator = v.union(
  v.object({ status: v.literal("pending") }),
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

const settlementSummaryValidator = v.object({
  stripePaymentIntentId: v.string(),
  stripeCheckoutSessionId: v.string(),
  pendingCheckoutId: v.union(v.id("pendingCheckouts"), v.null()),
  userId: v.id("users"),
  priceId: v.string(),
  creditsGranted: v.number(),
  amountUsd: v.number(),
  currency: v.string(),
  creditGrantCount: v.number(),
  revenueEventCount: v.number(),
  refundedAt: v.optional(v.number()),
  stripeRefundId: v.optional(v.string()),
  refundAmountUsd: v.optional(v.number()),
});

const settlementOutcomeValidator = v.union(
  v.object({
    outcome: v.literal("skipped"),
    reason: v.string(),
  }),
  v.object({
    outcome: v.literal("alreadyRecorded"),
    settlement: settlementSummaryValidator,
  }),
  v.object({
    outcome: v.literal("settled"),
    settlement: settlementSummaryValidator,
    creditApplied: v.boolean(),
  }),
);

const refundOutcomeValidator = v.union(
  v.object({ outcome: v.literal("noSettlement") }),
  v.object({
    outcome: v.literal("pendingSettlement"),
    stripeRefundId: v.string(),
    refundAmountUsd: v.number(),
  }),
  v.object({
    outcome: v.literal("alreadyRefunded"),
    stripeRefundId: v.string(),
    refundAmountUsd: v.number(),
  }),
  v.object({
    outcome: v.literal("refunded"),
    stripeRefundId: v.string(),
    refundAmountUsd: v.number(),
    creditsClawedBack: v.number(),
  }),
);

// ---------------------------------------------------------------------------
// Canary helpers
// ---------------------------------------------------------------------------

async function getProvisionedCanaryUser(
  ctx: Pick<QueryCtx, "db">,
  principalId: "CANARY_CHECKOUT" | "CANARY_SETTLEMENT",
) {
  const principal = await ctx.db
    .query("canaryPrincipals")
    .withIndex("by_principal_id", (q) => q.eq("principalId", principalId))
    .first();
  if (!principal?.appUserId) {
    throw new ConvexError(
      `${principalId} is not provisioned (missing canaryPrincipals row or appUserId)`,
    );
  }

  const user = await ctx.db.get(principal.appUserId);
  if (!user) {
    throw new ConvexError(`${principalId} app user no longer exists`);
  }

  return { principal, user };
}

async function assertNoActiveSettlementCanary(
  ctx: MutationCtx,
  userId: Id<"users">,
) {
  const pending = await ctx.db
    .query("pendingCheckouts")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "pending"),
    )
    .collect();
  if (pending.length > 0) {
    throw new ConvexError(
      "CANARY_SETTLEMENT already has a pending destructive checkout; resolve the existing run before starting another",
    );
  }

  const ready = await ctx.db
    .query("pendingCheckouts")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "ready"),
    )
    .collect();

  const readyCutoff = Date.now() - CHECKOUT_SESSION_EXPIRY_MS;
  for (const checkout of ready) {
    const settlement = await ctx.db
      .query("purchaseSettlements")
      .withIndex("by_pending_checkout", (q) =>
        q.eq("pendingCheckoutId", checkout._id),
      )
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
  if (!checkout || checkout.userId !== principal.appUserId) return null;

  return toCreditPackCheckoutStatus(checkout);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const requestCheckout = mutation({
  args: { priceId: v.string() },
  returns: v.id("pendingCheckouts"),
  handler: async (ctx, args) => {
    const user = await upsertCurrentUser(ctx);
    return await requestCreditPackCheckoutHelper(ctx, {
      userId: user._id,
      priceId: args.priceId,
      email: user.email,
      name: user.name,
      cachedStripeCustomerId: user.stripeCustomerId,
    });
  },
});

export const getCheckoutStatus = query({
  args: { checkoutId: v.id("pendingCheckouts") },
  returns: v.union(
    v.object({ status: v.literal("pending") }),
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

// ---------------------------------------------------------------------------
// Internal lifecycle/lease mutations + queries (consumed by the action)
// ---------------------------------------------------------------------------

export const claimCheckoutForProcessing = internalMutation({
  args: { checkoutId: v.id("pendingCheckouts") },
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
  handler: async (ctx, args) => {
    return await claimCheckoutForProcessingHelper(ctx, args);
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
    await markCheckoutReadyHelper(ctx, args);
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
    await markCheckoutFailedHelper(ctx, args);
    return null;
  },
});

export const releaseCheckoutProcessingLease = internalMutation({
  args: {
    checkoutId: v.id("pendingCheckouts"),
    leaseId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await releaseCheckoutProcessingLeaseHelper(ctx, args);
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
    await cacheStripeCustomerIdHelper(ctx, args);
    return null;
  },
});

export const getByStripeCheckoutSessionId = internalQuery({
  args: { stripeCheckoutSessionId: v.string() },
  returns: v.union(v.id("pendingCheckouts"), v.null()),
  handler: async (ctx, args) => {
    return await getCheckoutByStripeSessionId(
      ctx,
      args.stripeCheckoutSessionId,
    );
  },
});

// ---------------------------------------------------------------------------
// Settlement / refund webhook entry points
// ---------------------------------------------------------------------------

/**
 * Invoked by `http.ts` when Stripe delivers a `checkout.session.completed`
 * (or `checkout.session.async_payment_succeeded`) event. The raw session is
 * forwarded as-is so the module owns its own input validation; replays of
 * the same event fold to `outcome: "alreadyRecorded"`. The caller reacts
 * to the outcome (PostHog revenue, Discord ops alert on `skipped`) — those
 * side effects intentionally stay in `http.ts`.
 */
export const onStripeCheckoutCompleted = internalMutation({
  args: { session: v.any() },
  returns: settlementOutcomeValidator,
  handler: async (
    ctx,
    args,
  ): Promise<RecordPurchaseSettlementOutcome> => {
    const normalized = normalizeStripeCheckoutSessionWebhookPayload(args.session);
    if (!normalized.ok) {
      return { outcome: "skipped", reason: normalized.reason };
    }
    const candidate = getCreditPackSettlementCandidate(normalized.session);
    if (!candidate.ok) {
      return { outcome: "skipped", reason: candidate.reason };
    }

    const { settlement } = candidate;

    const pendingCheckoutId = await getCheckoutByStripeSessionId(
      ctx,
      settlement.stripeCheckoutSessionId,
    );

    return await recordPurchaseSettlementHelper(ctx, {
      userId: settlement.userId as Id<"users">,
      priceId: settlement.priceId,
      stripePaymentIntentId: settlement.stripePaymentIntentId,
      stripeCheckoutSessionId: settlement.stripeCheckoutSessionId,
      pendingCheckoutId: pendingCheckoutId ?? undefined,
      amountUsd: settlement.amountUsd,
      currency: settlement.currency,
    });
  },
});

/**
 * Invoked by `http.ts` when Stripe delivers a `charge.refunded` event.
 * Module parses the relevant bits (payment_intent, refund id/amount) and
 * folds duplicate deliveries to `outcome: "alreadyRefunded"`. Caller
 * decides what (if anything) to alert on.
 */
export const onStripeChargeRefunded = internalMutation({
  args: { charge: v.any() },
  returns: refundOutcomeValidator,
  handler: async (ctx, args): Promise<RecordRefundOutcome> => {
    const parsed = parseChargeRefundedWebhookPayload(args.charge);
    if (!parsed) {
      return { outcome: "noSettlement" };
    }

    return await recordRefundForPaymentIntentHelper(ctx, {
      stripePaymentIntentId: parsed.stripePaymentIntentId,
      stripeRefundId: parsed.stripeRefundId,
      refundAmountUsd: parsed.refundAmountUsd,
      refundedAt: parsed.refundedAt,
    });
  },
});

/**
 * Invoked by `http.ts` when Stripe delivers `refund.created` (preferred on
 * modern webhook API versions — see Stripe Acacia changelog). Same
 * idempotency semantics as `onStripeChargeRefunded`; register only one of
 * these unless both are proven safe against double clawback.
 */
export const onStripeRefundCreated = internalMutation({
  args: { refund: v.any() },
  returns: refundOutcomeValidator,
  handler: async (ctx, args): Promise<RecordRefundOutcome> => {
    const parsed = parseRefundCreatedWebhookPayload(args.refund);
    if (!parsed) {
      return { outcome: "noSettlement" };
    }

    return await recordRefundForPaymentIntentHelper(ctx, {
      stripePaymentIntentId: parsed.stripePaymentIntentId,
      stripeRefundId: parsed.stripeRefundId,
      refundAmountUsd: parsed.refundAmountUsd,
      refundedAt: parsed.refundedAt,
    });
  },
});

// ---------------------------------------------------------------------------
// Settlement queries (used by canary verification and ops dashboards)
// ---------------------------------------------------------------------------

export const getSettlementByPaymentIntentId = internalQuery({
  args: { stripePaymentIntentId: v.string() },
  returns: v.union(settlementSummaryValidator, v.null()),
  handler: async (ctx, args): Promise<SettlementSummary | null> => {
    return await getSettlementSummaryByPaymentIntent(
      ctx,
      args.stripePaymentIntentId,
    );
  },
});

export const getSettlementByPendingCheckoutId = internalQuery({
  args: { pendingCheckoutId: v.id("pendingCheckouts") },
  returns: v.union(settlementSummaryValidator, v.null()),
  handler: async (ctx, args): Promise<SettlementSummary | null> => {
    return await getSettlementSummaryByPendingCheckout(
      ctx,
      args.pendingCheckoutId,
    );
  },
});

// ---------------------------------------------------------------------------
// Canary runner entry points
// ---------------------------------------------------------------------------

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

    return await requestCreditPackCheckoutHelper(ctx, {
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

    return await requestCreditPackCheckoutHelper(ctx, {
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

export const getSettlementByPendingCheckoutForCanaryRunner = internalQuery({
  args: {
    runnerSecret: v.string(),
    pendingCheckoutId: v.id("pendingCheckouts"),
  },
  returns: v.union(settlementSummaryValidator, v.null()),
  handler: async (ctx, args): Promise<SettlementSummary | null> => {
    assertVerificationRunnerSecret(args.runnerSecret);

    const principal = await ctx.db
      .query("canaryPrincipals")
      .withIndex("by_principal_id", (q) =>
        q.eq("principalId", "CANARY_SETTLEMENT"),
      )
      .first();
    if (!principal?.appUserId) return null;

    const checkout = await ctx.db.get(args.pendingCheckoutId);
    if (!checkout || checkout.userId !== principal.appUserId) return null;

    return await getSettlementSummaryByPendingCheckout(
      ctx,
      args.pendingCheckoutId,
    );
  },
});

/**
 * Persistence half of the canary refund probe. The Node action calls this
 * after Stripe returns a refund id; folding to `alreadyRefunded` keeps
 * canary retries safe.
 */
export const recordRefundForCanary = internalMutation({
  args: {
    runnerSecret: v.string(),
    pendingCheckoutId: v.id("pendingCheckouts"),
    stripeRefundId: v.string(),
    refundAmountUsd: v.number(),
    refundedAt: v.number(),
  },
  returns: refundOutcomeValidator,
  handler: async (ctx, args): Promise<RecordRefundOutcome> => {
    assertVerificationRunnerSecret(args.runnerSecret);
    return await recordRefundForPendingCheckoutHelper(ctx, {
      pendingCheckoutId: args.pendingCheckoutId,
      stripeRefundId: args.stripeRefundId,
      refundAmountUsd: args.refundAmountUsd,
      refundedAt: args.refundedAt,
    });
  },
});

// ---------------------------------------------------------------------------
// QA reset wrapper
// ---------------------------------------------------------------------------

/**
 * Callable QA wrapper around `purgeUserPurchaseStateHelper`. The
 * `qaUserReset` mutation calls the helper directly to keep the entire
 * reset atomic; this entry point exists for symmetry/testability so QA
 * scripts can purge purchase state in isolation without touching auth or
 * generations.
 */
export const purgeUserPurchaseStateForQa = internalMutation({
  args: {
    runnerSecret: v.string(),
    userId: v.id("users"),
  },
  returns: v.object({
    pendingCheckoutsRemoved: v.number(),
    purchaseSettlementsRemoved: v.number(),
    purchaseCreditGrantsRemoved: v.number(),
  }),
  handler: async (ctx, args) => {
    assertVerificationRunnerSecret(args.runnerSecret);
    return await purgeUserPurchaseStateHelper(ctx, args.userId);
  },
});
