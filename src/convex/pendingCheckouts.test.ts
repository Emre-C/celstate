/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api.js";
import { CREDIT_PACK_CHECKOUT_PROCESSING_LEASE_MS } from "./lib/stripeCheckout.js";
import schema from "./schema.js";

process.env.SITE_URL ??= "http://127.0.0.1:4174";
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret";
process.env.AUTH_GOOGLE_ID ??= "test-google-client-id";
process.env.AUTH_GOOGLE_SECRET ??= "test-google-client-secret";

const modules = import.meta.glob([
  "/src/convex/**/*.ts",
  "!/src/convex/**/*.test.ts",
]);

async function seedPendingCheckout() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "checkout-durability@celstate.test",
      credits: 0,
    });
    const checkoutId = await ctx.db.insert("pendingCheckouts", {
      createdAt: 100,
      priceId: "price_test_starter",
      status: "pending" as const,
      userId,
    });

    return { checkoutId, userId };
  });

  return { t, ...ids };
}

describe("pending checkout processing leases", () => {
  it("claims a pending checkout once while the processing lease is live", async () => {
    const { checkoutId, t } = await seedPendingCheckout();

    const first = await t.mutation(internal.pendingCheckouts.claimCheckoutForProcessing, {
      checkoutId,
    });
    expect(first).toMatchObject({ ok: true, leaseId: expect.any(String) });

    const second = await t.mutation(internal.pendingCheckouts.claimCheckoutForProcessing, {
      checkoutId,
    });
    expect(second).toEqual({ ok: false, reason: "lease_held" });
  });

  it("lets a stale lease be reclaimed without letting the old owner fail the row", async () => {
    const { checkoutId, t } = await seedPendingCheckout();
    const staleLeaseId = "stale-lease";

    await t.run(async (ctx) => {
      await ctx.db.patch(checkoutId, {
        processingLeaseId: staleLeaseId,
        processingStartedAt: Date.now() - CREDIT_PACK_CHECKOUT_PROCESSING_LEASE_MS - 1,
      });
    });

    const reclaimed = await t.mutation(internal.pendingCheckouts.claimCheckoutForProcessing, {
      checkoutId,
    });
    expect(reclaimed).toMatchObject({ ok: true, leaseId: expect.any(String) });
    if (!reclaimed.ok) {
      throw new Error("Expected checkout claim to be reclaimed");
    }
    expect(reclaimed.leaseId).not.toBe(staleLeaseId);

    await t.mutation(internal.pendingCheckouts.markFailed, {
      checkoutId,
      error: "late stale failure",
      leaseId: staleLeaseId,
    });

    await expect(t.run((ctx) => ctx.db.get(checkoutId))).resolves.toMatchObject({
      processingLeaseId: reclaimed.leaseId,
      status: "pending",
    });

    await t.mutation(internal.pendingCheckouts.markReady, {
      checkoutId,
      checkoutUrl: "https://checkout.stripe.test/session",
      leaseId: reclaimed.leaseId,
      stripeCheckoutSessionId: "cs_test_reclaimed",
    });

    const readyCheckout = await t.run((ctx) => ctx.db.get(checkoutId));
    expect(readyCheckout).toMatchObject({
      checkoutUrl: "https://checkout.stripe.test/session",
      status: "ready",
      stripeCheckoutSessionId: "cs_test_reclaimed",
    });
    expect(readyCheckout?.processingLeaseId).toBeUndefined();
    expect(readyCheckout?.processingStartedAt).toBeUndefined();
  });

  it("does not let a stale owner release a newer lease", async () => {
    const { checkoutId, t } = await seedPendingCheckout();

    const claim = await t.mutation(internal.pendingCheckouts.claimCheckoutForProcessing, {
      checkoutId,
    });
    if (!claim.ok) {
      throw new Error("Expected checkout claim to succeed");
    }

    await t.mutation(internal.pendingCheckouts.releaseCheckoutProcessingLease, {
      checkoutId,
      leaseId: "stale-lease",
    });

    await expect(t.run((ctx) => ctx.db.get(checkoutId))).resolves.toMatchObject({
      processingLeaseId: claim.leaseId,
      status: "pending",
    });

    await t.mutation(internal.pendingCheckouts.releaseCheckoutProcessingLease, {
      checkoutId,
      leaseId: claim.leaseId,
    });

    const releasedCheckout = await t.run((ctx) => ctx.db.get(checkoutId));
    expect(releasedCheckout).toMatchObject({
      status: "pending",
    });
    expect(releasedCheckout?.processingLeaseId).toBeUndefined();
    expect(releasedCheckout?.processingStartedAt).toBeUndefined();
  });
});
