import { describe, expect, it } from "vitest";
import {
  canGrantCreditsForCheckoutSession,
  isKnownCreditPackPriceId,
} from "./stripeCheckout.js";

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
      isKnownCreditPackPriceId("price_starter", {
        starter: "price_starter",
        pro: "price_pro",
      }),
    ).toBe(true);
    expect(
      isKnownCreditPackPriceId("price_unknown", {
        starter: "price_starter",
        pro: "price_pro",
      }),
    ).toBe(false);
  });
});
