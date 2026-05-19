import type Stripe from "stripe";
import { internal } from "../../_generated/api.js";
import type { Doc, Id } from "../../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../../_generated/server.js";
import { applyCreditsToUser } from "../../users.js";
import { assertStripeEnv } from "../stripeEnv.js";
import {
  type CreditPack,
  type KnownCreditPackPriceIds,
  assertKnownCreditPackPriceId,
  getCreditPackByPriceId,
  getKnownCreditPackPriceIds,
} from "./catalog.js";
import type { CreditPackStripePort } from "./stripePort.js";

/**
 * How long a `processCheckout` action is trusted to hold its lease before a
 * concurrent invocation may reclaim it. Sized to be comfortably longer than
 * the slowest Stripe `customers.create` + `checkout.sessions.create` round
 * trip we have observed (~4s p99) but short enough that a truly orphaned
 * lease (action killed mid-flight) does not strand the pending checkout.
 */
export const CREDIT_PACK_CHECKOUT_PROCESSING_LEASE_MS = 60_000;

export type CreditPackCheckoutStatus =
  | { status: "pending" }
  | { status: "ready"; checkoutUrl: string; stripeCheckoutSessionId?: string }
  | { status: "failed"; error: string };

type CreditPackCheckoutRecord = Pick<
  Doc<"pendingCheckouts">,
  "checkoutUrl" | "error" | "status" | "stripeCheckoutSessionId"
>;

export type CreditPackProcessingClaim =
  | { ok: true; leaseId: string }
  | {
      ok: false;
      reason: "not_pending" | "lease_held" | "missing";
      existingSessionId?: string;
    };

/**
 * Minimal Checkout Session shape from Stripe webhooks (`checkout.session.*`).
 * Kept explicit so webhook handlers can normalize `unknown` payloads before
 * settlement logic runs.
 */
export type CreditPackCheckoutSession = {
  id: string;
  mode?: string | null;
  payment_status?: string | null;
  payment_intent?:
    | string
    | {
        id?: string | null;
      }
    | null;
  metadata?: {
    priceId?: string;
    userId?: string;
  } | null;
  amount_total?: number | null;
  currency?: string | null;
};

function readNonEmptyString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const val = obj[key];
  return typeof val === "string" && val.length > 0 ? val : undefined;
}

function readOptionalStringNullish(obj: Record<string, unknown>, key: string): string | null | undefined {
  const val = obj[key];
  if (val === null || val === undefined) return val as null | undefined;
  return typeof val === "string" ? val : undefined;
}

/**
 * Narrow an untrusted webhook `data.object` for checkout completion into
 * `CreditPackCheckoutSession`. On failure returns a skip reason suitable for
 * `onStripeCheckoutCompleted` (`outcome: "skipped"`).
 */
export function normalizeStripeCheckoutSessionWebhookPayload(
  input: unknown,
):
  | { ok: true; session: CreditPackCheckoutSession }
  | { ok: false; reason: string } {
  if (input === null || typeof input !== "object") {
    return { ok: false, reason: "Checkout session payload is not an object" };
  }
  const o = input as Record<string, unknown>;
  const id = readNonEmptyString(o, "id");
  if (!id) {
    return { ok: false, reason: "Checkout session is missing id" };
  }

  const mode = readOptionalStringNullish(o, "mode");
  const paymentStatus = readOptionalStringNullish(o, "payment_status");

  let payment_intent: CreditPackCheckoutSession["payment_intent"];
  const piRaw = o["payment_intent"];
  if (typeof piRaw === "string") {
    payment_intent = piRaw;
  } else if (piRaw !== null && typeof piRaw === "object") {
    const piObj = piRaw as Record<string, unknown>;
    const piId = piObj["id"];
    payment_intent = { id: typeof piId === "string" ? piId : null };
  } else {
    payment_intent = undefined;
  }

  let metadata: CreditPackCheckoutSession["metadata"];
  const metaRaw = o["metadata"];
  if (metaRaw !== null && typeof metaRaw === "object" && !Array.isArray(metaRaw)) {
    const m = metaRaw as Record<string, unknown>;
    const priceId = readNonEmptyString(m, "priceId");
    const userId = readNonEmptyString(m, "userId");
    if (priceId || userId) {
      metadata = { priceId, userId };
    }
  }

  const amountTotal = o["amount_total"];
  const amount_total =
    typeof amountTotal === "number" && Number.isFinite(amountTotal)
      ? amountTotal
      : null;

  const currencyRaw = o["currency"];
  const currency =
    typeof currencyRaw === "string" && currencyRaw.length > 0
      ? currencyRaw
      : null;

  return {
    ok: true,
    session: {
      id,
      mode: mode ?? undefined,
      payment_status: paymentStatus ?? undefined,
      payment_intent,
      metadata,
      amount_total,
      currency,
    },
  };
}

/**
 * Fields needed for `recordRefundForPaymentIntentHelper` from Stripe refund webhooks.
 */
export type ParsedRefundForPaymentIntent = {
  stripePaymentIntentId: string;
  stripeRefundId: string;
  refundAmountUsd: number;
  refundedAt: number;
};

/**
 * Parse `charge.refunded` event `data.object` (Charge expansion shape).
 */
export function parseChargeRefundedWebhookPayload(
  input: unknown,
): ParsedRefundForPaymentIntent | null {
  if (input === null || typeof input !== "object") return null;
  const charge = input as Record<string, unknown>;

  const piRaw = charge["payment_intent"];
  const paymentIntentId =
    typeof piRaw === "string"
      ? piRaw
      : piRaw !== null &&
          typeof piRaw === "object" &&
          typeof (piRaw as Record<string, unknown>)["id"] === "string"
        ? ((piRaw as Record<string, unknown>)["id"] as string)
        : undefined;

  if (!paymentIntentId) return null;

  const refunds = charge["refunds"];
  let latestRefund: Record<string, unknown> | null = null;
  if (refunds !== null && typeof refunds === "object" && !Array.isArray(refunds)) {
    const data = (refunds as Record<string, unknown>)["data"];
    if (Array.isArray(data) && data.length > 0) {
      const last = data[data.length - 1];
      if (last !== null && typeof last === "object" && !Array.isArray(last)) {
        latestRefund = last as Record<string, unknown>;
      }
    }
  }

  const refundId =
    latestRefund && typeof latestRefund["id"] === "string" && latestRefund["id"].length > 0
      ? latestRefund["id"]
      : `charge_refund_${typeof charge["id"] === "string" ? charge["id"] : "unknown"}`;

  let refundAmountCents = 0;
  if (
    latestRefund &&
    typeof latestRefund["amount"] === "number" &&
    Number.isFinite(latestRefund["amount"])
  ) {
    refundAmountCents = latestRefund["amount"];
  } else if (
    typeof charge["amount_refunded"] === "number" &&
    Number.isFinite(charge["amount_refunded"])
  ) {
    refundAmountCents = charge["amount_refunded"];
  }

  let refundedAtSec: number;
  if (
    latestRefund &&
    typeof latestRefund["created"] === "number" &&
    Number.isFinite(latestRefund["created"])
  ) {
    refundedAtSec = latestRefund["created"];
  } else if (
    typeof charge["created"] === "number" &&
    Number.isFinite(charge["created"])
  ) {
    refundedAtSec = charge["created"];
  } else {
    refundedAtSec = Math.floor(Date.now() / 1000);
  }

  return {
    stripePaymentIntentId: paymentIntentId,
    stripeRefundId: refundId,
    refundAmountUsd: refundAmountCents / 100,
    refundedAt: refundedAtSec * 1000,
  };
}

/**
 * Parse `refund.created` event `data.object` (Refund resource).
 * Prefer this on webhook API versions where refund events carry full details.
 */
export function parseRefundCreatedWebhookPayload(
  input: unknown,
): ParsedRefundForPaymentIntent | null {
  if (input === null || typeof input !== "object") return null;
  const refund = input as Record<string, unknown>;

  const id =
    typeof refund["id"] === "string" && refund["id"].length > 0
      ? refund["id"]
      : null;
  if (!id) return null;

  const piRaw = refund["payment_intent"];
  const paymentIntentId =
    typeof piRaw === "string"
      ? piRaw
      : piRaw !== null &&
          typeof piRaw === "object" &&
          typeof (piRaw as Record<string, unknown>)["id"] === "string"
        ? ((piRaw as Record<string, unknown>)["id"] as string)
        : undefined;

  if (!paymentIntentId) return null;

  const amountRaw = refund["amount"];
  const amountCents =
    typeof amountRaw === "number" && Number.isFinite(amountRaw) ? amountRaw : 0;

  const createdRaw = refund["created"];
  const createdSec =
    typeof createdRaw === "number" && Number.isFinite(createdRaw)
      ? createdRaw
      : Math.floor(Date.now() / 1000);

  return {
    stripePaymentIntentId: paymentIntentId,
    stripeRefundId: id,
    refundAmountUsd: amountCents / 100,
    refundedAt: createdSec * 1000,
  };
}

export type RecordPurchaseSettlementArgs = {
  userId: Id<"users">;
  priceId: string;
  stripePaymentIntentId: string;
  stripeCheckoutSessionId: string;
  pendingCheckoutId?: Id<"pendingCheckouts">;
  amountUsd: number;
  currency: string;
};

export type RecordPurchaseSettlementOutcome =
  | {
      outcome: "skipped";
      reason: string;
    }
  | {
      outcome: "alreadyRecorded";
      settlement: SettlementSummary;
    }
  | {
      outcome: "settled";
      settlement: SettlementSummary;
      creditApplied: boolean;
    };

export type SettlementSummary = {
  stripePaymentIntentId: string;
  stripeCheckoutSessionId: string;
  pendingCheckoutId: Id<"pendingCheckouts"> | null;
  userId: Id<"users">;
  priceId: string;
  creditsGranted: number;
  amountUsd: number;
  currency: string;
  creditGrantCount: number;
  revenueEventCount: number;
  refundedAt?: number;
  stripeRefundId?: string;
  refundAmountUsd?: number;
};

export type RecordRefundArgs = {
  pendingCheckoutId: Id<"pendingCheckouts">;
  stripeRefundId: string;
  refundAmountUsd: number;
  refundedAt: number;
};

type RefundPersistenceArgs = {
  stripeRefundId: string;
  refundAmountUsd: number;
  refundedAt: number;
};

export type RecordRefundOutcome =
  | { outcome: "noSettlement" }
  | {
      outcome: "pendingSettlement";
      stripeRefundId: string;
      refundAmountUsd: number;
    }
  | {
      outcome: "alreadyRefunded";
      stripeRefundId: string;
      refundAmountUsd: number;
    }
  | {
      outcome: "refunded";
      stripeRefundId: string;
      refundAmountUsd: number;
      creditsClawedBack: number;
    };

// ---------------------------------------------------------------------------
// Pure helpers (no Convex ctx)
// ---------------------------------------------------------------------------

export function buildCreditPackCheckoutSessionIdempotencyKey(
  checkoutId: Id<"pendingCheckouts">,
): string {
  return `credit_pack_checkout:${checkoutId}`;
}

export function buildCreditPackRefundIdempotencyKey(
  pendingCheckoutId: Id<"pendingCheckouts">,
): string {
  return `canary-refund-${pendingCheckoutId}`;
}

type BuildCheckoutSessionParamsArgs = {
  customerId: string;
  priceId: string;
  userId: Id<"users">;
};

export function buildStripeCheckoutSessionCreateParams(
  args: BuildCheckoutSessionParamsArgs,
): Stripe.Checkout.SessionCreateParams {
  const stripeEnv = assertStripeEnv();
  const creditPack = assertKnownCreditPackPriceId(args.priceId);
  const userId = String(args.userId);

  return {
    cancel_url: `${stripeEnv.siteUrl}/app?canceled=true`,
    customer: args.customerId,
    line_items: [
      {
        price: creditPack.priceId,
        quantity: 1,
      },
    ],
    metadata: {
      priceId: creditPack.priceId,
      userId,
    },
    mode: "payment",
    payment_intent_data: {
      metadata: {
        priceId: creditPack.priceId,
        userId,
      },
    },
    success_url: `${stripeEnv.siteUrl}/app?success=true`,
  };
}

export function canGrantCreditsForCheckoutSession(session: {
  mode?: string | null;
  payment_status?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (session.mode !== "payment") {
    return {
      ok: false,
      reason: `Unexpected checkout mode: ${session.mode ?? "unknown"}`,
    };
  }

  if (session.payment_status !== "paid") {
    return {
      ok: false,
      reason: `Checkout session is not paid (status=${session.payment_status ?? "unknown"})`,
    };
  }

  return { ok: true };
}

export type CreditPackSettlementCandidate =
  | {
      ok: true;
      settlement: {
        userId: string;
        priceId: string;
        creditsGranted: number;
        stripePaymentIntentId: string;
        stripeCheckoutSessionId: string;
        amountUsd: number;
        currency: string;
      };
    }
  | { ok: false; reason: string };

export function getCreditPackSettlementCandidate(
  session: CreditPackCheckoutSession,
  knownPriceIds: KnownCreditPackPriceIds = getKnownCreditPackPriceIds(),
): CreditPackSettlementCandidate {
  const grantEligibility = canGrantCreditsForCheckoutSession(session);
  if (!grantEligibility.ok) return grantEligibility;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!paymentIntentId) {
    return {
      ok: false,
      reason: "Checkout session is missing payment_intent",
    };
  }

  const priceId = session.metadata?.priceId;
  if (!priceId) {
    return {
      ok: false,
      reason: "Checkout session is missing priceId metadata",
    };
  }

  const creditPack = getCreditPackByPriceId(priceId, knownPriceIds);
  if (!creditPack) {
    return {
      ok: false,
      reason: `Unknown credit pack priceId: ${priceId}`,
    };
  }

  const userId = session.metadata?.userId;
  if (!userId) {
    return {
      ok: false,
      reason: "Checkout session is missing userId metadata",
    };
  }

  return {
    ok: true,
    settlement: {
      userId,
      priceId: creditPack.priceId,
      creditsGranted: creditPack.credits,
      stripePaymentIntentId: paymentIntentId,
      stripeCheckoutSessionId: session.id,
      amountUsd: (session.amount_total ?? 0) / 100,
      currency: session.currency ?? "usd",
    },
  };
}

export function toCreditPackCheckoutStatus(
  checkout: CreditPackCheckoutRecord,
): CreditPackCheckoutStatus {
  if (checkout.status === "ready") {
    return {
      status: "ready",
      checkoutUrl: checkout.checkoutUrl ?? "",
      stripeCheckoutSessionId: checkout.stripeCheckoutSessionId,
    };
  }

  if (checkout.status === "failed") {
    return {
      status: "failed",
      error: checkout.error ?? "Unknown error",
    };
  }

  return { status: "pending" };
}

// ---------------------------------------------------------------------------
// Mutation helpers (take MutationCtx; called by creditPackPurchase.ts wrappers
// and the QA-reset purge path so ACID stays atomic in one mutation)
// ---------------------------------------------------------------------------

type RequestCreditPackCheckoutHelperArgs = {
  cachedStripeCustomerId?: string;
  email?: string;
  name?: string;
  priceId: string;
  requireExistingStripeCustomerId?: boolean;
  userId: Id<"users">;
};

export async function requestCreditPackCheckoutHelper(
  ctx: MutationCtx,
  args: RequestCreditPackCheckoutHelperArgs,
): Promise<Id<"pendingCheckouts">> {
  const creditPack = assertKnownCreditPackPriceId(args.priceId);
  const checkoutId = await ctx.db.insert("pendingCheckouts", {
    userId: args.userId,
    priceId: creditPack.priceId,
    status: "pending",
    createdAt: Date.now(),
  });

  await ctx.scheduler.runAfter(
    0,
    internal.creditPackPurchaseActions.processCheckout,
    {
      checkoutId,
      userId: args.userId,
      priceId: creditPack.priceId,
      email: args.email,
      name: args.name,
      cachedStripeCustomerId: args.cachedStripeCustomerId,
      requireExistingStripeCustomerId: args.requireExistingStripeCustomerId,
    },
  );

  return checkoutId;
}

export async function claimCheckoutForProcessingHelper(
  ctx: MutationCtx,
  args: { checkoutId: Id<"pendingCheckouts"> },
): Promise<CreditPackProcessingClaim> {
  const checkout = await ctx.db.get(args.checkoutId);
  if (!checkout) return { ok: false, reason: "missing" };

  if (checkout.status !== "pending") {
    return {
      ok: false,
      reason: "not_pending",
      existingSessionId: checkout.stripeCheckoutSessionId ?? undefined,
    };
  }

  const now = Date.now();
  const leaseDeadline =
    (checkout.processingStartedAt ?? 0) + CREDIT_PACK_CHECKOUT_PROCESSING_LEASE_MS;
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
}

export async function markCheckoutReadyHelper(
  ctx: MutationCtx,
  args: {
    checkoutId: Id<"pendingCheckouts">;
    checkoutUrl: string;
    leaseId: string;
    stripeCheckoutSessionId?: string;
  },
): Promise<void> {
  const checkout = await ctx.db.get(args.checkoutId);
  // Only the still-pending row owned by this lease may be promoted to
  // ready. A late or replayed success path must never clobber a row that
  // has already been marked failed (or, defensively, already ready) — that
  // would lose the canonical stripeCheckoutSessionId we use for refund/
  // canary/audit correlation. The lease owner check prevents an action
  // whose timed-out lease was reclaimed from promoting the row after a
  // newer invocation took over.
  if (
    !checkout ||
    checkout.status !== "pending" ||
    checkout.processingLeaseId !== args.leaseId
  ) {
    return;
  }

  await ctx.db.patch(args.checkoutId, {
    status: "ready",
    checkoutUrl: args.checkoutUrl,
    stripeCheckoutSessionId: args.stripeCheckoutSessionId,
    processingLeaseId: undefined,
    processingStartedAt: undefined,
  });
}

export async function markCheckoutFailedHelper(
  ctx: MutationCtx,
  args: {
    checkoutId: Id<"pendingCheckouts">;
    error: string;
    leaseId: string;
  },
): Promise<void> {
  const checkout = await ctx.db.get(args.checkoutId);
  if (
    !checkout ||
    checkout.status !== "pending" ||
    checkout.processingLeaseId !== args.leaseId
  ) {
    return;
  }

  await ctx.db.patch(args.checkoutId, {
    status: "failed",
    error: args.error,
    processingLeaseId: undefined,
    processingStartedAt: undefined,
  });
}

export async function releaseCheckoutProcessingLeaseHelper(
  ctx: MutationCtx,
  args: {
    checkoutId: Id<"pendingCheckouts">;
    leaseId: string;
  },
): Promise<void> {
  const checkout = await ctx.db.get(args.checkoutId);
  if (!checkout || checkout.processingLeaseId !== args.leaseId) return;

  await ctx.db.patch(args.checkoutId, {
    processingLeaseId: undefined,
    processingStartedAt: undefined,
  });
}

export async function cacheStripeCustomerIdHelper(
  ctx: MutationCtx,
  args: { userId: Id<"users">; stripeCustomerId: string },
): Promise<void> {
  await ctx.db.patch(args.userId, {
    stripeCustomerId: args.stripeCustomerId,
  });
}

export async function getCheckoutByStripeSessionId(
  ctx: QueryCtx,
  stripeCheckoutSessionId: string,
): Promise<Id<"pendingCheckouts"> | null> {
  const row = await ctx.db
    .query("pendingCheckouts")
    .withIndex("by_stripe_checkout_session", (q) =>
      q.eq("stripeCheckoutSessionId", stripeCheckoutSessionId),
    )
    .first();
  return row?._id ?? null;
}

async function buildSettlementSummary(
  ctx: QueryCtx | MutationCtx,
  settlement: Doc<"purchaseSettlements">,
  totalSettlementsForPaymentIntent: number,
): Promise<SettlementSummary> {
  const creditGrants = await ctx.db
    .query("creditGrants")
    .withIndex("by_payment_intent", (q) =>
      q.eq("stripePaymentIntentId", settlement.stripePaymentIntentId),
    )
    .collect();

  return {
    stripePaymentIntentId: settlement.stripePaymentIntentId,
    stripeCheckoutSessionId: settlement.stripeCheckoutSessionId,
    pendingCheckoutId: settlement.pendingCheckoutId,
    userId: settlement.userId,
    priceId: settlement.priceId,
    creditsGranted: settlement.creditsGranted,
    amountUsd: settlement.amountUsd,
    currency: settlement.currency,
    creditGrantCount: creditGrants.length,
    revenueEventCount: totalSettlementsForPaymentIntent,
    refundedAt: settlement.refundedAt,
    stripeRefundId: settlement.stripeRefundId,
    refundAmountUsd: settlement.refundAmountUsd,
  };
}

export async function getSettlementSummaryByPaymentIntent(
  ctx: QueryCtx | MutationCtx,
  stripePaymentIntentId: string,
): Promise<SettlementSummary | null> {
  const settlements = await ctx.db
    .query("purchaseSettlements")
    .withIndex("by_payment_intent", (q) =>
      q.eq("stripePaymentIntentId", stripePaymentIntentId),
    )
    .collect();
  if (settlements.length === 0) return null;
  return buildSettlementSummary(
    ctx,
    settlements[settlements.length - 1]!,
    settlements.length,
  );
}

export async function getSettlementSummaryByPendingCheckout(
  ctx: QueryCtx | MutationCtx,
  pendingCheckoutId: Id<"pendingCheckouts">,
): Promise<SettlementSummary | null> {
  const settlements = await ctx.db
    .query("purchaseSettlements")
    .withIndex("by_pending_checkout", (q) =>
      q.eq("pendingCheckoutId", pendingCheckoutId),
    )
    .collect();
  if (settlements.length === 0) return null;
  // Re-query by payment intent so the credit-grant count stays consistent
  // with `getSettlementSummaryByPaymentIntent`.
  const latest = settlements[settlements.length - 1]!;
  const allForPi = await ctx.db
    .query("purchaseSettlements")
    .withIndex("by_payment_intent", (q) =>
      q.eq("stripePaymentIntentId", latest.stripePaymentIntentId),
    )
    .collect();
  return buildSettlementSummary(ctx, latest, allForPi.length);
}

type PaymentIntentRefundArgs = RefundPersistenceArgs & {
  stripePaymentIntentId: string;
};

function pendingRefundOutcome(
  refund: Pick<Doc<"pendingPurchaseRefunds">, "refundAmountUsd" | "stripeRefundId">,
): RecordRefundOutcome {
  return {
    outcome: "pendingSettlement",
    stripeRefundId: refund.stripeRefundId,
    refundAmountUsd: refund.refundAmountUsd,
  };
}

function assertPendingRefundMatches(
  existing: Doc<"pendingPurchaseRefunds">,
  args: PaymentIntentRefundArgs,
): void {
  if (existing.stripePaymentIntentId !== args.stripePaymentIntentId) {
    throw new Error("Pending refund was recorded for a different payment intent");
  }
  if (existing.stripeRefundId !== args.stripeRefundId) {
    throw new Error("Payment intent already has a pending refund with a different Stripe refund ID");
  }
  if (existing.refundAmountUsd !== args.refundAmountUsd) {
    throw new Error("Pending refund amount changed for the same Stripe refund ID");
  }
}

async function recordPendingRefundForPaymentIntentHelper(
  ctx: MutationCtx,
  args: PaymentIntentRefundArgs,
): Promise<RecordRefundOutcome> {
  const existingByRefund = await ctx.db
    .query("pendingPurchaseRefunds")
    .withIndex("by_refund", (q) => q.eq("stripeRefundId", args.stripeRefundId))
    .first();

  if (existingByRefund) {
    assertPendingRefundMatches(existingByRefund, args);
    return pendingRefundOutcome(existingByRefund);
  }

  const existingByPaymentIntent = await ctx.db
    .query("pendingPurchaseRefunds")
    .withIndex("by_payment_intent", (q) =>
      q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
    )
    .first();

  if (existingByPaymentIntent) {
    assertPendingRefundMatches(existingByPaymentIntent, args);
    return pendingRefundOutcome(existingByPaymentIntent);
  }

  await ctx.db.insert("pendingPurchaseRefunds", {
    stripePaymentIntentId: args.stripePaymentIntentId,
    stripeRefundId: args.stripeRefundId,
    refundAmountUsd: args.refundAmountUsd,
    refundedAt: args.refundedAt,
    createdAt: Date.now(),
  });

  return {
    outcome: "pendingSettlement",
    stripeRefundId: args.stripeRefundId,
    refundAmountUsd: args.refundAmountUsd,
  };
}

async function recordRefundOnSettlementHelper(
  ctx: MutationCtx,
  settlement: Doc<"purchaseSettlements">,
  args: RefundPersistenceArgs,
): Promise<RecordRefundOutcome> {
  if (settlement.refundedAt) {
    if (
      settlement.stripeRefundId &&
      settlement.stripeRefundId !== args.stripeRefundId
    ) {
      throw new Error("Settlement was already refunded with a different Stripe refund ID");
    }
    return {
      outcome: "alreadyRefunded",
      stripeRefundId: settlement.stripeRefundId ?? args.stripeRefundId,
      refundAmountUsd: settlement.refundAmountUsd ?? args.refundAmountUsd,
    };
  }

  let creditsClawedBack = 0;
  const user = await ctx.db.get(settlement.userId);
  if (user) {
    const current = user.credits ?? 0;
    creditsClawedBack = Math.min(current, settlement.creditsGranted);
    if (creditsClawedBack > 0) {
      await ctx.db.patch(settlement.userId, {
        credits: current - creditsClawedBack,
      });
    }
  }

  await ctx.db.patch(settlement._id, {
    refundRequestedAt: settlement.refundRequestedAt ?? args.refundedAt,
    refundedAt: args.refundedAt,
    stripeRefundId: args.stripeRefundId,
    refundAmountUsd: args.refundAmountUsd,
  });

  return {
    outcome: "refunded",
    stripeRefundId: args.stripeRefundId,
    refundAmountUsd: args.refundAmountUsd,
    creditsClawedBack,
  };
}

async function consumePendingRefundForSettlement(
  ctx: MutationCtx,
  settlement: Doc<"purchaseSettlements">,
): Promise<RecordRefundOutcome | null> {
  const pendingRefund = await ctx.db
    .query("pendingPurchaseRefunds")
    .withIndex("by_payment_intent", (q) =>
      q.eq("stripePaymentIntentId", settlement.stripePaymentIntentId),
    )
    .first();

  if (!pendingRefund) return null;

  const outcome = await recordRefundOnSettlementHelper(ctx, settlement, {
    stripeRefundId: pendingRefund.stripeRefundId,
    refundAmountUsd: pendingRefund.refundAmountUsd,
    refundedAt: pendingRefund.refundedAt,
  });
  await ctx.db.delete(pendingRefund._id);
  return outcome;
}

/**
 * Records a settled credit-pack purchase. The composed invariant defended
 * here:
 *   1. At most one settlement row per `pendingCheckoutId`.
 *   2. At most one settlement row per `stripePaymentIntentId`.
 *   3. At most one purchase credit grant per `stripePaymentIntentId`.
 * Webhook redelivery, replays of the same Stripe event, and concurrent
 * `checkout.session.completed` + `checkout.session.async_payment_succeeded`
 * deliveries all fold to `outcome: "alreadyRecorded"` here. The mutation
 * is ACID, so check-then-write cannot race.
 */
export async function recordPurchaseSettlementHelper(
  ctx: MutationCtx,
  args: RecordPurchaseSettlementArgs,
): Promise<RecordPurchaseSettlementOutcome> {
  let creditPack: CreditPack;
  try {
    creditPack = assertKnownCreditPackPriceId(args.priceId);
  } catch (e) {
    return {
      outcome: "skipped",
      reason: e instanceof Error ? e.message : "Invalid credit pack",
    };
  }

  const pendingCheckoutId = args.pendingCheckoutId;

  if (pendingCheckoutId) {
    const existingByCheckout = await ctx.db
      .query("purchaseSettlements")
      .withIndex("by_pending_checkout", (q) =>
        q.eq("pendingCheckoutId", pendingCheckoutId),
      )
      .first();
    if (existingByCheckout) {
      const summary = await getSettlementSummaryByPaymentIntent(
        ctx,
        existingByCheckout.stripePaymentIntentId,
      );
      return {
        outcome: "alreadyRecorded",
        settlement: summary!,
      };
    }
  }

  const existingByPi = await ctx.db
    .query("purchaseSettlements")
    .withIndex("by_payment_intent", (q) =>
      q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
    )
    .first();

  if (existingByPi) {
    const summary = await getSettlementSummaryByPaymentIntent(
      ctx,
      args.stripePaymentIntentId,
    );
    return {
      outcome: "alreadyRecorded",
      settlement: summary!,
    };
  }

  const existingGrant = await ctx.db
    .query("creditGrants")
    .withIndex("by_payment_intent", (q) =>
      q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
    )
    .first();

  let creditApplied = false;
  let creditGrantCreatedAt = existingGrant?.createdAt ?? Date.now();

  if (!existingGrant) {
    const applied = await applyCreditsToUser(ctx, args.userId, creditPack.credits);
    if (!applied) {
      return {
        outcome: "skipped",
        reason: `User ${args.userId} not found when applying credits`,
      };
    }
    creditApplied = true;
    creditGrantCreatedAt = Date.now();
    await ctx.db.insert("creditGrants", {
      userId: args.userId,
      amount: creditPack.credits,
      reason: "purchase",
      stripePaymentIntentId: args.stripePaymentIntentId,
      createdAt: creditGrantCreatedAt,
    });
  }

  const now = Date.now();
  const settlementId = await ctx.db.insert("purchaseSettlements", {
    stripePaymentIntentId: args.stripePaymentIntentId,
    stripeCheckoutSessionId: args.stripeCheckoutSessionId,
    pendingCheckoutId: pendingCheckoutId ?? null,
    userId: args.userId,
    priceId: creditPack.priceId,
    creditsGranted: creditPack.credits,
    amountUsd: args.amountUsd,
    currency: args.currency,
    creditGrantCreatedAt,
    revenueEventCreatedAt: now,
    createdAt: now,
  });

  const settlement = await ctx.db.get(settlementId);
  if (settlement) {
    await consumePendingRefundForSettlement(ctx, settlement);
  }

  const summary = await getSettlementSummaryByPaymentIntent(
    ctx,
    args.stripePaymentIntentId,
  );
  return {
    outcome: "settled",
    settlement: summary!,
    creditApplied,
  };
}

/**
 * Records a refund against a previously-settled purchase. Idempotent: a
 * duplicate webhook delivery with the same `stripeRefundId` returns
 * `alreadyRefunded` without re-clawing back credits. A second refund with
 * a *different* `stripeRefundId` is rejected as a hard error since it
 * indicates an external desync that should be investigated.
 */
export async function recordRefundForPendingCheckoutHelper(
  ctx: MutationCtx,
  args: RecordRefundArgs,
): Promise<RecordRefundOutcome> {
  const settlements = await ctx.db
    .query("purchaseSettlements")
    .withIndex("by_pending_checkout", (q) =>
      q.eq("pendingCheckoutId", args.pendingCheckoutId),
    )
    .collect();

  if (settlements.length === 0) {
    return { outcome: "noSettlement" };
  }

  if (settlements.length > 1) {
    // Defensive — recordPurchaseSettlementHelper enforces at-most-one per
    // pendingCheckoutId so this branch should be unreachable. Keeping the
    // explicit throw makes future regressions loud rather than silent.
    throw new Error(
      "Multiple settlement rows match this pending checkout; refund recording is not authoritative",
    );
  }

  const settlement = settlements[0]!;
  return await recordRefundOnSettlementHelper(ctx, settlement, {
    stripeRefundId: args.stripeRefundId,
    refundAmountUsd: args.refundAmountUsd,
    refundedAt: args.refundedAt,
  });
}

/**
 * Locates a settlement for a Stripe refund webhook. Refunds carry a
 * `payment_intent` and a `charge.id`; we look up by payment intent because
 * that is the same key the settlement was recorded under.
 */
export async function recordRefundForPaymentIntentHelper(
  ctx: MutationCtx,
  args: {
    stripePaymentIntentId: string;
    stripeRefundId: string;
    refundAmountUsd: number;
    refundedAt: number;
  },
): Promise<RecordRefundOutcome> {
  const settlement = await ctx.db
    .query("purchaseSettlements")
    .withIndex("by_payment_intent", (q) =>
      q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
    )
    .first();

  if (!settlement) {
    return await recordPendingRefundForPaymentIntentHelper(ctx, args);
  }

  return await recordRefundOnSettlementHelper(ctx, settlement, {
    stripeRefundId: args.stripeRefundId,
    refundAmountUsd: args.refundAmountUsd,
    refundedAt: args.refundedAt,
  });
}

/**
 * Wipes all module-owned rows for a user. Used by the QA reset path. The
 * caller (qaUserReset) authenticates the request; this helper assumes the
 * call is authorized. Runs in the caller's MutationCtx so the entire reset
 * stays atomic.
 */
export async function purgeUserPurchaseStateHelper(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<{
  pendingCheckoutsRemoved: number;
  purchaseSettlementsRemoved: number;
  purchaseCreditGrantsRemoved: number;
}> {
  let pendingCheckoutsRemoved = 0;
  for (const status of ["pending", "ready", "failed"] as const) {
    for (const row of await ctx.db
      .query("pendingCheckouts")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", status))
      .collect()) {
      await ctx.db.delete(row._id);
      pendingCheckoutsRemoved++;
    }
  }

  let purchaseSettlementsRemoved = 0;
  for (const row of await ctx.db
    .query("purchaseSettlements")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) {
    await ctx.db.delete(row._id);
    purchaseSettlementsRemoved++;
  }

  let purchaseCreditGrantsRemoved = 0;
  for (const row of await ctx.db
    .query("creditGrants")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) {
    if (row.reason === "purchase") {
      await ctx.db.delete(row._id);
      purchaseCreditGrantsRemoved++;
    }
  }

  return {
    pendingCheckoutsRemoved,
    purchaseSettlementsRemoved,
    purchaseCreditGrantsRemoved,
  };
}

// ---------------------------------------------------------------------------
// Action runners — pure functions that take a port and a runMutation
// callable. The Convex action wires production deps; tests wire the
// in-memory port and a t.mutation-backed runner.
// ---------------------------------------------------------------------------

export type ProcessCheckoutArgs = {
  checkoutId: Id<"pendingCheckouts">;
  userId: Id<"users">;
  priceId: string;
  email?: string;
  name?: string;
  cachedStripeCustomerId?: string;
  requireExistingStripeCustomerId?: boolean;
};

/**
 * Action body that drives a single pending credit-pack checkout through
 * Stripe. The lease, Stripe idempotency key, and terminal ready/failed writes
 * form the durability contract. Extracted as a pure function so tests can
 * inject the in-memory port.
 */
export async function runProcessCheckout(
  runners: {
    claim: (args: {
      checkoutId: Id<"pendingCheckouts">;
    }) => Promise<CreditPackProcessingClaim>;
    cacheCustomer: (args: {
      userId: Id<"users">;
      stripeCustomerId: string;
    }) => Promise<void>;
    markReady: (args: {
      checkoutId: Id<"pendingCheckouts">;
      checkoutUrl: string;
      leaseId: string;
      stripeCheckoutSessionId?: string;
    }) => Promise<void>;
    markFailed: (args: {
      checkoutId: Id<"pendingCheckouts">;
      error: string;
      leaseId: string;
    }) => Promise<void>;
  },
  port: CreditPackStripePort,
  args: ProcessCheckoutArgs,
): Promise<void> {
  const claim = await runners.claim({ checkoutId: args.checkoutId });

  if (!claim.ok) {
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

      const customer = await port.getOrCreateCustomer({
        userId: userIdStr,
        email: args.email,
        name: args.name,
      });
      customerId = customer.customerId;

      await runners.cacheCustomer({
        userId: args.userId,
        stripeCustomerId: customerId,
      });
    }

    stripeCallStarted = true;
    const session = await port.createCheckoutSession({
      params: buildStripeCheckoutSessionCreateParams({
        customerId,
        priceId: args.priceId,
        userId: args.userId,
      }),
      idempotencyKey: buildCreditPackCheckoutSessionIdempotencyKey(args.checkoutId),
    });

    await runners.markReady({
      checkoutId: args.checkoutId,
      checkoutUrl: session.url ?? "",
      leaseId: claim.leaseId,
      stripeCheckoutSessionId: session.id,
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
    await runners.markFailed({
      checkoutId: args.checkoutId,
      error: message,
      leaseId: claim.leaseId,
    });
  }
}

export type RefundCanaryResult = {
  stripeRefundId: string;
  refundAmountUsd: number;
  alreadyRefunded: boolean;
};

/**
 * Action body for the canary refund probe. Looks up the settlement, calls
 * Stripe via the port (with an idempotency key derived from the pending
 * checkout id so duplicate canary runs don't double-refund), and persists
 * the refund through `recordRefundForPendingCheckoutHelper`. Tests inject
 * the in-memory port; production wires the real Stripe SDK.
 */
export async function runRefundCheckoutForCanary(
  runners: {
    getSettlement: (args: {
      pendingCheckoutId: Id<"pendingCheckouts">;
    }) => Promise<SettlementSummary | null>;
    recordRefund: (args: RecordRefundArgs) => Promise<RecordRefundOutcome>;
  },
  port: CreditPackStripePort,
  args: { pendingCheckoutId: Id<"pendingCheckouts"> },
): Promise<RefundCanaryResult> {
  const settlement = await runners.getSettlement({
    pendingCheckoutId: args.pendingCheckoutId,
  });

  if (!settlement) {
    throw new Error(
      "No settlement found for this pending checkout, or checkout does not belong to CANARY_SETTLEMENT",
    );
  }

  if (settlement.refundedAt) {
    return {
      stripeRefundId: settlement.stripeRefundId ?? "unknown",
      refundAmountUsd: settlement.refundAmountUsd ?? 0,
      alreadyRefunded: true,
    };
  }

  const refund = await port.createRefund({
    paymentIntentId: settlement.stripePaymentIntentId,
    idempotencyKey: buildCreditPackRefundIdempotencyKey(args.pendingCheckoutId),
  });

  const refundAmountUsd = refund.amountCents / 100;

  const outcome = await runners.recordRefund({
    pendingCheckoutId: args.pendingCheckoutId,
    stripeRefundId: refund.id,
    refundAmountUsd,
    refundedAt: Date.now(),
  });

  if (outcome.outcome === "alreadyRefunded") {
    return {
      stripeRefundId: outcome.stripeRefundId,
      refundAmountUsd: outcome.refundAmountUsd,
      alreadyRefunded: true,
    };
  }

  return {
    stripeRefundId: refund.id,
    refundAmountUsd,
    alreadyRefunded: false,
  };
}
