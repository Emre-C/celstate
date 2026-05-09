import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryStripePort } from "./inMemoryStripeAdapter.js";
import {
  buildCreditPackCheckoutSessionIdempotencyKey,
  buildCreditPackRefundIdempotencyKey,
  buildStripeCheckoutSessionCreateParams,
  canGrantCreditsForCheckoutSession,
  getCreditPackSettlementCandidate,
  normalizeStripeCheckoutSessionWebhookPayload,
  parseChargeRefundedWebhookPayload,
  parseRefundCreatedWebhookPayload,
  runProcessCheckout,
  runRefundCheckoutForCanary,
} from "./lifecycle.js";
import type { Id } from "../../_generated/dataModel.js";

const knownPriceIds = {
  starter: "price_starter",
  pro: "price_pro",
} as const;

describe("creditPackPurchase lifecycle — webhook payload normalization", () => {
  it("normalizeStripeCheckoutSessionWebhookPayload rejects non-objects", () => {
    expect(normalizeStripeCheckoutSessionWebhookPayload(null)).toEqual({
      ok: false,
      reason: "Checkout session payload is not an object",
    });
  });

  it("normalizeStripeCheckoutSessionWebhookPayload requires id", () => {
    expect(normalizeStripeCheckoutSessionWebhookPayload({})).toEqual({
      ok: false,
      reason: "Checkout session is missing id",
    });
  });

  it("normalizeStripeCheckoutSessionWebhookPayload builds a session for settlement", () => {
    const r = normalizeStripeCheckoutSessionWebhookPayload({
      id: "cs_1",
      mode: "payment",
      payment_status: "paid",
      payment_intent: "pi_1",
      metadata: { priceId: "price_starter", userId: "u1" },
      amount_total: 500,
      currency: "usd",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(
      getCreditPackSettlementCandidate(r.session, knownPriceIds),
    ).toMatchObject({
      ok: true,
      settlement: expect.objectContaining({
        stripeCheckoutSessionId: "cs_1",
        stripePaymentIntentId: "pi_1",
      }),
    });
  });

  it("parseChargeRefundedWebhookPayload reads payment_intent and refund", () => {
    expect(
      parseChargeRefundedWebhookPayload({
        id: "ch_1",
        payment_intent: "pi_abc",
        refunds: {
          data: [{ id: "re_1", amount: 999, created: 1700000000 }],
        },
      }),
    ).toEqual({
      stripePaymentIntentId: "pi_abc",
      stripeRefundId: "re_1",
      refundAmountUsd: 9.99,
      refundedAt: 1700000000000,
    });
  });

  it("parseRefundCreatedWebhookPayload reads Refund resource", () => {
    expect(
      parseRefundCreatedWebhookPayload({
        id: "re_x",
        payment_intent: "pi_y",
        amount: 1500,
        created: 1700000001,
      }),
    ).toEqual({
      stripePaymentIntentId: "pi_y",
      stripeRefundId: "re_x",
      refundAmountUsd: 15,
      refundedAt: 1700000001000,
    });
  });

  it("parseRefundCreatedWebhookPayload returns null without payment_intent", () => {
    expect(
      parseRefundCreatedWebhookPayload({
        id: "re_x",
        amount: 100,
        created: 1,
      }),
    ).toBeNull();
  });
});

describe("creditPackPurchase lifecycle — pure settlement helpers", () => {
  it("idempotency keys are stable", () => {
    expect(buildCreditPackCheckoutSessionIdempotencyKey("id1" as Id<"pendingCheckouts">)).toBe(
      "credit_pack_checkout:id1",
    );
    expect(buildCreditPackRefundIdempotencyKey("id2" as Id<"pendingCheckouts">)).toBe(
      "canary-refund-id2",
    );
  });

  it("canGrantCreditsForCheckoutSession enforces payment mode and paid status", () => {
    expect(
      canGrantCreditsForCheckoutSession({
        mode: "payment",
        payment_status: "paid",
      }),
    ).toEqual({ ok: true });
    expect(
      canGrantCreditsForCheckoutSession({
        mode: "subscription",
        payment_status: "paid",
      }).ok,
    ).toBe(false);
  });
});

describe("creditPackPurchase lifecycle — runProcessCheckout", () => {
  beforeEach(() => {
    // Force valid Stripe-shaped values so host env (e.g. restricted keys) cannot fail these unit tests.
    vi.stubEnv("SITE_URL", "https://celstate.test");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_process_checkout_dummy");
    vi.stubEnv("STRIPE_PRICE_STARTER", "price_starter");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_pro");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_process_checkout_dummy");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("skips Stripe when claim is not ok", async () => {
    const port = createInMemoryStripePort();
    await runProcessCheckout(
      {
        claim: async () => ({ ok: false, reason: "lease_held" }),
        cacheCustomer: async () => {},
        markReady: async () => {},
        markFailed: async () => {},
      },
      port,
      {
        checkoutId: "c1" as Id<"pendingCheckouts">,
        userId: "u1" as Id<"users">,
        priceId: "price_starter",
      },
    );
    expect(port.getCallLog()).toEqual([]);
  });

  it("replays checkout session create on same idempotency key", async () => {
    const port = createInMemoryStripePort();
    const key = buildCreditPackCheckoutSessionIdempotencyKey("chk" as Id<"pendingCheckouts">);
    const params = buildStripeCheckoutSessionCreateParams({
      customerId: "cus_x",
      priceId: "price_starter",
      userId: "u1" as Id<"users">,
    });
    const first = await port.createCheckoutSession({ params, idempotencyKey: key });
    const second = await port.createCheckoutSession({ params, idempotencyKey: key });
    expect(first.id).toBe(second.id);
    expect(port.getCallLog().filter((e) => e.kind === "createCheckoutSession")).toEqual([
      expect.objectContaining({ idempotencyKey: key, replay: false }),
      expect.objectContaining({ idempotencyKey: key, replay: true }),
    ]);
  });

  it("marks failed when checkout session create throws after claim", async () => {
    const port = createInMemoryStripePort();
    port.failNextCall(new Error("stripe down"));
    const markFailedCalls: unknown[] = [];
    await runProcessCheckout(
      {
        claim: async () => ({ ok: true, leaseId: "lease-1" }),
        cacheCustomer: async () => {},
        markReady: async () => {
          throw new Error("should not mark ready");
        },
        markFailed: async (a) => {
          markFailedCalls.push(a);
        },
      },
      port,
      {
        checkoutId: "c1" as Id<"pendingCheckouts">,
        userId: "u1" as Id<"users">,
        priceId: "price_starter",
        cachedStripeCustomerId: "cus_cached",
      },
    );
    expect(markFailedCalls).toEqual([
      expect.objectContaining({
        checkoutId: "c1" as Id<"pendingCheckouts">,
        leaseId: "lease-1",
        error: "stripe down",
      }),
    ]);
  });
});

describe("creditPackPurchase lifecycle — runRefundCheckoutForCanary", () => {
  it("throws when settlement is missing", async () => {
    const port = createInMemoryStripePort();
    await expect(
      runRefundCheckoutForCanary(
        {
          getSettlement: async () => null,
          recordRefund: async () => ({ outcome: "noSettlement" }),
        },
        port,
        { pendingCheckoutId: "p1" as Id<"pendingCheckouts"> },
      ),
    ).rejects.toThrow(/No settlement found/);
  });

  it("returns alreadyRefunded without calling Stripe when settlement refunded", async () => {
    const port = createInMemoryStripePort();
    const r = await runRefundCheckoutForCanary(
      {
        getSettlement: async () => ({
          stripePaymentIntentId: "pi_1",
          stripeCheckoutSessionId: "cs_1",
          pendingCheckoutId: "p1" as Id<"pendingCheckouts">,
          userId: "u1" as Id<"users">,
          priceId: "price_starter",
          creditsGranted: 15,
          amountUsd: 5,
          currency: "usd",
          creditGrantCount: 1,
          revenueEventCount: 1,
          refundedAt: 1,
          stripeRefundId: "re_old",
          refundAmountUsd: 5,
        }),
        recordRefund: async () => ({ outcome: "noSettlement" }),
      },
      port,
      { pendingCheckoutId: "p1" as Id<"pendingCheckouts"> },
    );
    expect(r).toEqual({
      stripeRefundId: "re_old",
      refundAmountUsd: 5,
      alreadyRefunded: true,
    });
    expect(port.getCallLog()).toEqual([]);
  });
});
