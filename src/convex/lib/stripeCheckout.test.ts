import { describe, expect, it } from "vitest";
import {
  buildCreditPackCheckoutSessionIdempotencyKey,
  buildStripeCheckoutSessionCreateParams,
  canGrantCreditsForCheckoutSession,
  getCreditPackByPriceId,
  getCreditPackSettlementCandidate,
  isKnownCreditPackPriceId,
} from "./stripeCheckout.js";

const knownPriceIds = {
  starter: "price_starter",
  pro: "price_pro",
} as const;

describe("stripe checkout credit grants", () => {
  it("allows paid payment-mode checkout sessions", () => {
    expect(
      canGrantCreditsForCheckoutSession({
        mode: "payment",
        payment_status: "paid",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects unpaid checkout sessions", () => {
    expect(
      canGrantCreditsForCheckoutSession({
        mode: "payment",
        payment_status: "unpaid",
      }),
    ).toEqual({
      ok: false,
      reason: "Checkout session is not paid (status=unpaid)",
    });
  });

  it("rejects non-payment checkout modes", () => {
    expect(
      canGrantCreditsForCheckoutSession({
        mode: "subscription",
        payment_status: "paid",
      }),
    ).toEqual({
      ok: false,
      reason: "Unexpected checkout mode: subscription",
    });
  });

  it("recognizes known credit pack prices", () => {
    expect(
      isKnownCreditPackPriceId("price_starter", knownPriceIds),
    ).toBe(true);
    expect(
      isKnownCreditPackPriceId("price_unknown", knownPriceIds),
    ).toBe(false);
  });

  it("resolves the catalog entry for a checkout price", () => {
    expect(getCreditPackByPriceId("price_pro", knownPriceIds)).toEqual({
      key: "pro",
      priceId: "price_pro",
      credits: 40,
    });
  });

  it("builds deterministic Stripe Checkout create params and idempotency keys", () => {
    process.env.SITE_URL = "https://celstate.test";
    process.env.STRIPE_SECRET_KEY = "sk_test_checkout_params";
    process.env.STRIPE_PRICE_STARTER = "price_starter";
    process.env.STRIPE_PRICE_PRO = "price_pro";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_checkout_params";

    expect(buildCreditPackCheckoutSessionIdempotencyKey("checkout_123" as never)).toBe(
      "credit_pack_checkout:checkout_123",
    );
    expect(
      buildStripeCheckoutSessionCreateParams({
        customerId: "cus_123",
        priceId: "price_starter",
        userId: "user_123" as never,
      }),
    ).toEqual({
      cancel_url: "https://celstate.test/app?canceled=true",
      customer: "cus_123",
      line_items: [
        {
          price: "price_starter",
          quantity: 1,
        },
      ],
      metadata: {
        priceId: "price_starter",
        userId: "user_123",
      },
      mode: "payment",
      payment_intent_data: {
        metadata: {
          priceId: "price_starter",
          userId: "user_123",
        },
      },
      success_url: "https://celstate.test/app?success=true",
    });
  });

  it("extracts a settled credit-pack purchase from checkout session metadata", () => {
    expect(
      getCreditPackSettlementCandidate(
        {
          id: "cs_test_123",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_test_123",
          metadata: {
            priceId: "price_starter",
            userId: "user_123",
          },
          amount_total: 500,
          currency: "usd",
        },
        knownPriceIds,
      ),
    ).toEqual({
      ok: true,
      settlement: {
        userId: "user_123",
        priceId: "price_starter",
        creditsGranted: 15,
        stripePaymentIntentId: "pi_test_123",
        stripeCheckoutSessionId: "cs_test_123",
        amountUsd: 5,
        currency: "usd",
      },
    });
  });

  it("rejects checkout sessions whose priceId is outside the credit-pack catalog", () => {
    expect(
      getCreditPackSettlementCandidate(
        {
          id: "cs_test_123",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_test_123",
          metadata: {
            priceId: "price_unknown",
            userId: "user_123",
          },
        },
        knownPriceIds,
      ),
    ).toEqual({
      ok: false,
      reason: "Unknown credit pack priceId: price_unknown",
    });
  });
});
