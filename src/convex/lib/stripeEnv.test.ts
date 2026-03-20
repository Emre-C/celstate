import { describe, expect, it } from "vitest";
import { validateStripeEnv, type StripeEnv } from "./stripeEnv.js";

const validLiveEnv: StripeEnv = {
  stripeSecretKey: "sk_live_abc123",
  stripePriceStarter: "price_starter123",
  stripePricePro: "price_pro456",
  stripeWebhookSecret: "whsec_webhook789",
  siteUrl: "https://celstate.app",
};

const validTestEnv: StripeEnv = {
  stripeSecretKey: "sk_test_abc123",
  stripePriceStarter: "price_starter123",
  stripePricePro: "price_pro456",
  stripeWebhookSecret: "whsec_webhook789",
  siteUrl: "http://localhost:5173",
};

describe("stripe-env validation", () => {
  it("passes for valid live environment", () => {
    expect(validateStripeEnv(validLiveEnv)).toEqual([]);
  });

  it("passes for valid test environment", () => {
    expect(validateStripeEnv(validTestEnv)).toEqual([]);
  });

  it("detects missing variables", () => {
    const errors = validateStripeEnv({
      stripeSecretKey: "",
      stripePriceStarter: "",
      stripePricePro: "",
      stripeWebhookSecret: "",
      siteUrl: "",
    });

    const variables = errors.map((e) => e.variable);
    expect(variables).toContain("STRIPE_SECRET_KEY");
    expect(variables).toContain("STRIPE_PRICE_STARTER");
    expect(variables).toContain("STRIPE_PRICE_PRO");
    expect(variables).toContain("STRIPE_WEBHOOK_SECRET");
    expect(variables).toContain("SITE_URL");
  });

  it("detects invalid secret key prefix", () => {
    const errors = validateStripeEnv({
      ...validLiveEnv,
      stripeSecretKey: "rk_live_abc123",
    });

    expect(errors).toContainEqual(
      expect.objectContaining({
        variable: "STRIPE_SECRET_KEY",
        message: expect.stringContaining("sk_live_"),
      }),
    );
  });

  it("detects invalid price ID prefix", () => {
    const errors = validateStripeEnv({
      ...validLiveEnv,
      stripePriceStarter: "prod_starter123",
    });

    expect(errors).toContainEqual(
      expect.objectContaining({
        variable: "STRIPE_PRICE_STARTER",
        message: expect.stringContaining("price_"),
      }),
    );
  });

  it("detects invalid webhook secret prefix", () => {
    const errors = validateStripeEnv({
      ...validLiveEnv,
      stripeWebhookSecret: "not_a_webhook_secret",
    });

    expect(errors).toContainEqual(
      expect.objectContaining({
        variable: "STRIPE_WEBHOOK_SECRET",
        message: expect.stringContaining("whsec_"),
      }),
    );
  });

});
