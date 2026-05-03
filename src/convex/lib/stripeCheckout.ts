import { ConvexError } from "convex/values";
import type Stripe from "stripe";
import { internal } from "../_generated/api.js";
import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { applyCreditsToUser } from "../users.js";
import { assertStripeEnv } from "./stripeEnv.js";

const CREDIT_PACK_CATALOG = {
  starter: { credits: 15 },
  pro: { credits: 40 },
} as const;

type CreditPackKey = keyof typeof CREDIT_PACK_CATALOG;

export type KnownCreditPackPriceIds = {
  [Key in CreditPackKey]: string;
};

export type CreditPack = {
  key: CreditPackKey;
  priceId: string;
  credits: number;
};

export type CreditPackCheckoutStatus =
  | { status: "pending" }
  | {
      status: "ready";
      checkoutUrl: string;
      stripeCheckoutSessionId?: string;
    }
  | { status: "failed"; error: string };

type CreditPackCheckoutRecord = Pick<
  Doc<"pendingCheckouts">,
  "checkoutUrl" | "error" | "status" | "stripeCheckoutSessionId"
>;

/**
 * How long a `processCheckout` action is trusted to hold its lease before a
 * concurrent invocation may reclaim it. Sized to be comfortably longer than
 * the slowest Stripe `customers.create` + `checkout.sessions.create` round
 * trip we have observed (~4s p99) but short enough that a truly orphaned
 * lease (action killed mid-flight) does not strand the pending checkout.
 */
export const CREDIT_PACK_CHECKOUT_PROCESSING_LEASE_MS = 60_000;

type CreditPackSettlementEligibility = { ok: true } | { ok: false; reason: string };

export type CreditPackProcessingClaim =
  | { ok: true; leaseId: string }
  | { ok: false; reason: "not_pending" | "lease_held" | "missing"; existingSessionId?: string };

type CreditPackCheckoutSession = {
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

type RequestCreditPackCheckoutArgs = {
  cachedStripeCustomerId?: string;
  email?: string;
  name?: string;
  priceId: string;
  requireExistingStripeCustomerId?: boolean;
  userId: Id<"users">;
};

type BuildCreditPackCheckoutSessionArgs = {
  customerId: string;
  priceId: string;
  userId: Id<"users">;
};

export type RecordCreditPackPurchaseSettlementArgs = {
  userId: Id<"users">;
  priceId: string;
  stripePaymentIntentId: string;
  stripeCheckoutSessionId: string;
  pendingCheckoutId?: Id<"pendingCheckouts">;
  amountUsd: number;
  currency: string;
};

export type RecordCreditPackPurchaseSettlementResult = {
  alreadyRecorded: boolean;
  created: boolean;
  creditApplied: boolean;
};

export function getKnownCreditPackPriceIds(): KnownCreditPackPriceIds {
  const stripeEnv = assertStripeEnv();

  return {
    starter: stripeEnv.stripePriceStarter,
    pro: stripeEnv.stripePricePro,
  };
}

export function getCreditPackCatalog(
  knownPriceIds: KnownCreditPackPriceIds = getKnownCreditPackPriceIds(),
): Record<CreditPackKey, CreditPack> {
  return {
    starter: {
      key: "starter",
      priceId: knownPriceIds.starter,
      credits: CREDIT_PACK_CATALOG.starter.credits,
    },
    pro: {
      key: "pro",
      priceId: knownPriceIds.pro,
      credits: CREDIT_PACK_CATALOG.pro.credits,
    },
  };
}

export function getCreditPackByPriceId(
  priceId: string,
  knownPriceIds: KnownCreditPackPriceIds = getKnownCreditPackPriceIds(),
): CreditPack | null {
  const catalog = getCreditPackCatalog(knownPriceIds);

  if (priceId === catalog.starter.priceId) {
    return catalog.starter;
  }

  if (priceId === catalog.pro.priceId) {
    return catalog.pro;
  }

  return null;
}

export function assertKnownCreditPackPriceId(
  priceId: string,
  knownPriceIds: KnownCreditPackPriceIds = getKnownCreditPackPriceIds(),
): CreditPack {
  const creditPack = getCreditPackByPriceId(priceId, knownPriceIds);
  if (!creditPack) {
    throw new ConvexError("Invalid credit pack");
  }

  return creditPack;
}

export function canGrantCreditsForCheckoutSession(session: {
  mode?: string | null;
  payment_status?: string | null;
}): CreditPackSettlementEligibility {
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

export function isKnownCreditPackPriceId(
  priceId: string,
  knownPriceIds: KnownCreditPackPriceIds = getKnownCreditPackPriceIds(),
): boolean {
  return getCreditPackByPriceId(priceId, knownPriceIds) !== null;
}

export async function requestCreditPackCheckout(
  ctx: MutationCtx,
  args: RequestCreditPackCheckoutArgs,
) {
  const creditPack = assertKnownCreditPackPriceId(args.priceId);
  const checkoutId = await ctx.db.insert("pendingCheckouts", {
    userId: args.userId,
    priceId: creditPack.priceId,
    status: "pending",
    createdAt: Date.now(),
  });

  await ctx.scheduler.runAfter(0, internal.stripe.processCheckout, {
    checkoutId,
    userId: args.userId,
    priceId: creditPack.priceId,
    email: args.email,
    name: args.name,
    cachedStripeCustomerId: args.cachedStripeCustomerId,
    requireExistingStripeCustomerId: args.requireExistingStripeCustomerId,
  });

  return checkoutId;
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

export function buildCreditPackCheckoutSessionArgs(
  args: BuildCreditPackCheckoutSessionArgs,
) {
  const stripeEnv = assertStripeEnv();
  const creditPack = assertKnownCreditPackPriceId(args.priceId);
  const userId = String(args.userId);

  return {
    priceId: creditPack.priceId,
    customerId: args.customerId,
    mode: "payment" as const,
    successUrl: `${stripeEnv.siteUrl}/app?success=true`,
    cancelUrl: `${stripeEnv.siteUrl}/app?canceled=true`,
    paymentIntentMetadata: {
      priceId: creditPack.priceId,
      userId,
    },
    metadata: {
      priceId: creditPack.priceId,
      userId,
    },
  };
}

export function buildCreditPackCheckoutSessionIdempotencyKey(
  checkoutId: Id<"pendingCheckouts">,
): string {
  return `credit_pack_checkout:${checkoutId}`;
}

export function buildStripeCheckoutSessionCreateParams(
  args: BuildCreditPackCheckoutSessionArgs,
): Stripe.Checkout.SessionCreateParams {
  const checkout = buildCreditPackCheckoutSessionArgs(args);
  return {
    cancel_url: checkout.cancelUrl,
    customer: checkout.customerId,
    line_items: [
      {
        price: checkout.priceId,
        quantity: 1,
      },
    ],
    metadata: checkout.metadata,
    mode: checkout.mode,
    payment_intent_data: {
      metadata: checkout.paymentIntentMetadata,
    },
    success_url: checkout.successUrl,
  };
}

export function getCreditPackSettlementCandidate(
  session: CreditPackCheckoutSession,
  knownPriceIds: KnownCreditPackPriceIds = getKnownCreditPackPriceIds(),
):
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
  | { ok: false; reason: string } {
  const grantEligibility = canGrantCreditsForCheckoutSession(session);
  if (!grantEligibility.ok) {
    return grantEligibility;
  }

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

export async function recordCreditPackPurchaseSettlement(
  ctx: MutationCtx,
  args: RecordCreditPackPurchaseSettlementArgs,
): Promise<RecordCreditPackPurchaseSettlementResult> {
  const creditPack = assertKnownCreditPackPriceId(args.priceId);
  const pendingCheckoutId = args.pendingCheckoutId;

  if (pendingCheckoutId) {
    const existingCheckoutSettlement = await ctx.db
      .query("purchaseSettlements")
      .withIndex("by_pending_checkout", (q) => q.eq("pendingCheckoutId", pendingCheckoutId))
      .first();

    if (existingCheckoutSettlement) {
      return {
        alreadyRecorded: true,
        created: false,
        creditApplied: false,
      };
    }
  }

  const existingSettlement = await ctx.db
    .query("purchaseSettlements")
    .withIndex("by_payment_intent", (q) => q.eq("stripePaymentIntentId", args.stripePaymentIntentId))
    .first();

  if (existingSettlement) {
    return {
      alreadyRecorded: true,
      created: false,
      creditApplied: false,
    };
  }

  const existingGrant = await ctx.db
    .query("creditGrants")
    .withIndex("by_payment_intent", (q) => q.eq("stripePaymentIntentId", args.stripePaymentIntentId))
    .first();

  let creditApplied = false;
  let creditGrantCreatedAt = existingGrant?.createdAt ?? Date.now();

  if (!existingGrant) {
    const applied = await applyCreditsToUser(ctx, args.userId, creditPack.credits);
    if (!applied) {
      return {
        alreadyRecorded: false,
        created: false,
        creditApplied: false,
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
  await ctx.db.insert("purchaseSettlements", {
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

  return {
    alreadyRecorded: false,
    created: true,
    creditApplied,
  };
}
