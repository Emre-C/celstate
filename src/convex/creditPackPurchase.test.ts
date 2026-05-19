/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { CREDIT_PACK_CHECKOUT_PROCESSING_LEASE_MS } from "./lib/creditPackPurchase/lifecycle.js";
import schema from "./schema.js";

const modules = import.meta.glob([
  "/src/convex/**/*.ts",
  "!/src/convex/**/*.test.ts",
]);

const RUNNER_SECRET = "test-runner-secret-for-credit-pack";

beforeEach(() => {
  vi.stubEnv("SITE_URL", "http://127.0.0.1:4174");
  vi.stubEnv("AUTH_GOOGLE_ID", "test-google-client-id");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "test-google-client-secret");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_credit_pack_purchase");
  vi.stubEnv("STRIPE_PRICE_STARTER", "price_test_starter");
  vi.stubEnv("STRIPE_PRICE_PRO", "price_test_pro");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_credit_pack_purchase");
  vi.stubEnv("VERIFICATION_RUNNER_SECRET", RUNNER_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function paidSessionArgs(userId: Id<"users">, checkoutId: string) {
  return {
    id: checkoutId,
    mode: "payment" as const,
    payment_status: "paid" as const,
    payment_intent: "pi_test_settle",
    metadata: {
      priceId: "price_test_starter",
      userId: String(userId),
    },
    amount_total: 500,
    currency: "usd",
  };
}

describe("creditPackPurchase leases", () => {
  it("claims once while lease held; second gets lease_held", async () => {
    const t = convexTest(schema, modules);
    const { checkoutId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "lease-a@celstate.test",
        credits: 0,
      });
      const cid = await ctx.db.insert("pendingCheckouts", {
        createdAt: 100,
        priceId: "price_test_starter",
        status: "pending" as const,
        userId,
      });
      return { checkoutId: cid, userId };
    });

    const first = await t.mutation(internal.creditPackPurchase.claimCheckoutForProcessing, {
      checkoutId,
    });
    expect(first).toMatchObject({ ok: true, leaseId: expect.any(String) });

    const second = await t.mutation(internal.creditPackPurchase.claimCheckoutForProcessing, {
      checkoutId,
    });
    expect(second).toEqual({ ok: false, reason: "lease_held" });
  });

  it("stale lease reclaim: stale owner markFailed is no-op; new owner can markReady", async () => {
    const t = convexTest(schema, modules);
    const checkoutId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "lease-b@celstate.test",
        credits: 0,
      });
      return await ctx.db.insert("pendingCheckouts", {
        createdAt: 100,
        priceId: "price_test_starter",
        status: "pending" as const,
        userId,
      });
    });

    const staleLeaseId = "stale-lease";
    await t.run(async (ctx) => {
      await ctx.db.patch(checkoutId, {
        processingLeaseId: staleLeaseId,
        processingStartedAt: Date.now() - CREDIT_PACK_CHECKOUT_PROCESSING_LEASE_MS - 1,
      });
    });

    const reclaimed = await t.mutation(internal.creditPackPurchase.claimCheckoutForProcessing, {
      checkoutId,
    });
    expect(reclaimed).toMatchObject({ ok: true, leaseId: expect.any(String) });
    if (!reclaimed.ok) throw new Error("expected reclaim");

    await t.mutation(internal.creditPackPurchase.markFailed, {
      checkoutId,
      error: "late stale failure",
      leaseId: staleLeaseId,
    });

    await expect(t.run((ctx) => ctx.db.get(checkoutId))).resolves.toMatchObject({
      processingLeaseId: reclaimed.leaseId,
      status: "pending",
    });

    await t.mutation(internal.creditPackPurchase.markReady, {
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
  });

  it("stale owner cannot release a newer lease", async () => {
    const t = convexTest(schema, modules);
    const checkoutId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "lease-c@celstate.test",
        credits: 0,
      });
      return await ctx.db.insert("pendingCheckouts", {
        createdAt: 100,
        priceId: "price_test_starter",
        status: "pending" as const,
        userId,
      });
    });

    const claim = await t.mutation(internal.creditPackPurchase.claimCheckoutForProcessing, {
      checkoutId,
    });
    if (!claim.ok) throw new Error("expected claim");

    await t.mutation(internal.creditPackPurchase.releaseCheckoutProcessingLease, {
      checkoutId,
      leaseId: "stale-lease",
    });

    await expect(t.run((ctx) => ctx.db.get(checkoutId))).resolves.toMatchObject({
      processingLeaseId: claim.leaseId,
      status: "pending",
    });

    await t.mutation(internal.creditPackPurchase.releaseCheckoutProcessingLease, {
      checkoutId,
      leaseId: claim.leaseId,
    });

    const released = await t.run((ctx) => ctx.db.get(checkoutId));
    expect(released).toMatchObject({ status: "pending" });
    expect(released?.processingLeaseId).toBeUndefined();
  });
});

describe("creditPackPurchase settlement and refunds", () => {
  it("settles once; replay is alreadyRecorded", async () => {
    const t = convexTest(schema, modules);
    const { checkoutId, userId } = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "settle@celstate.test",
        credits: 0,
      });
      const cid = await ctx.db.insert("pendingCheckouts", {
        createdAt: 100,
        priceId: "price_test_starter",
      status: "ready" as const,
      checkoutUrl: "https://x.test",
        stripeCheckoutSessionId: "cs_test_settle_1",
        userId: uid,
      });
      return { checkoutId: cid, userId: uid };
    });

    const session = paidSessionArgs(userId, "cs_test_settle_1");
    const first = await t.mutation(internal.creditPackPurchase.onStripeCheckoutCompleted, { session });
    expect(first.outcome).toBe("settled");
    if (first.outcome !== "settled") throw new Error("expected settled");

    const userAfter = await t.run((ctx) => ctx.db.get(userId));
    expect(userAfter?.credits).toBe(15);

    const second = await t.mutation(internal.creditPackPurchase.onStripeCheckoutCompleted, { session });
    expect(second.outcome).toBe("alreadyRecorded");
  });

  it("skips unpaid checkout sessions without writes", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "skip@celstate.test",
        credits: 0,
      });
    });

    const r = await t.mutation(internal.creditPackPurchase.onStripeCheckoutCompleted, {
      session: {
        id: "cs_unpaid",
        mode: "payment",
        payment_status: "unpaid",
        payment_intent: "pi_u",
        metadata: { priceId: "price_test_starter", userId: String(userId) },
      },
    });
    expect(r.outcome).toBe("skipped");

    const settlements = await t.run(async (ctx) =>
      ctx.db.query("purchaseSettlements").collect(),
    );
    expect(settlements).toHaveLength(0);
  });

  it("onStripeRefundCreated idempotent; mismatched second refund id throws", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "refund@celstate.test",
        credits: 15,
      });
      await ctx.db.insert("creditGrants", {
        userId: uid,
        amount: 15,
        reason: "purchase" as const,
        stripePaymentIntentId: "pi_refund_1",
        createdAt: 100,
      });
      await ctx.db.insert("purchaseSettlements", {
        stripePaymentIntentId: "pi_refund_1",
        stripeCheckoutSessionId: "cs_r1",
        pendingCheckoutId: null,
        userId: uid,
        priceId: "price_test_starter",
        creditsGranted: 15,
        amountUsd: 5,
        currency: "usd",
        creditGrantCreatedAt: 100,
        revenueEventCreatedAt: 100,
        createdAt: 100,
      });
      return { userId: uid };
    });

    const refund = {
      id: "re_first",
      payment_intent: "pi_refund_1",
      amount: 500,
      created: 1700000000,
    };

    const first = await t.mutation(internal.creditPackPurchase.onStripeRefundCreated, { refund });
    expect(first.outcome).toBe("refunded");

    const userAfterFirst = await t.run((ctx) => ctx.db.get(userId));
    expect(userAfterFirst?.credits).toBe(0);

    const second = await t.mutation(internal.creditPackPurchase.onStripeRefundCreated, { refund });
    expect(second.outcome).toBe("alreadyRefunded");

    await expect(
      t.mutation(internal.creditPackPurchase.onStripeRefundCreated, {
        refund: { ...refund, id: "re_other" },
      }),
    ).rejects.toThrow(/different Stripe refund ID/);
  });

  it("records refund before settlement and consumes it when checkout settlement arrives", async () => {
    const t = convexTest(schema, modules);
    const { checkoutId, userId } = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "refund-before-settle@celstate.test",
        credits: 0,
      });
      const cid = await ctx.db.insert("pendingCheckouts", {
        createdAt: 100,
        priceId: "price_test_starter",
        status: "ready" as const,
        checkoutUrl: "https://x.test",
        stripeCheckoutSessionId: "cs_refund_before_settlement",
        userId: uid,
      });
      return { checkoutId: cid, userId: uid };
    });

    const refund = {
      id: "re_before_settlement",
      payment_intent: "pi_refund_before_settlement",
      amount: 500,
      created: 1700000000,
    };

    const pending = await t.mutation(internal.creditPackPurchase.onStripeRefundCreated, { refund });
    expect(pending).toEqual({
      outcome: "pendingSettlement",
      stripeRefundId: "re_before_settlement",
      refundAmountUsd: 5,
    });

    await expect(
      t.mutation(internal.creditPackPurchase.onStripeRefundCreated, { refund }),
    ).resolves.toEqual({
      outcome: "pendingSettlement",
      stripeRefundId: "re_before_settlement",
      refundAmountUsd: 5,
    });

    await expect(
      t.run(async (ctx) => ctx.db.query("pendingPurchaseRefunds").collect()),
    ).resolves.toHaveLength(1);

    const settled = await t.mutation(internal.creditPackPurchase.onStripeCheckoutCompleted, {
      session: {
        id: "cs_refund_before_settlement",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_refund_before_settlement",
        metadata: {
          priceId: "price_test_starter",
          userId: String(userId),
        },
        amount_total: 500,
        currency: "usd",
      },
    });
    expect(settled.outcome).toBe("settled");
    if (settled.outcome !== "settled") throw new Error("expected settled");
    expect(settled.settlement).toMatchObject({
      pendingCheckoutId: checkoutId,
      stripeRefundId: "re_before_settlement",
      refundAmountUsd: 5,
    });

    await expect(t.run((ctx) => ctx.db.get(userId))).resolves.toMatchObject({
      credits: 0,
    });
    await expect(
      t.run(async (ctx) => ctx.db.query("pendingPurchaseRefunds").collect()),
    ).resolves.toHaveLength(0);

    await expect(
      t.mutation(internal.creditPackPurchase.onStripeRefundCreated, { refund }),
    ).resolves.toMatchObject({
      outcome: "alreadyRefunded",
      stripeRefundId: "re_before_settlement",
      refundAmountUsd: 5,
    });
  });

  it("clawback clamps to current credits", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "clamp@celstate.test",
        credits: 3,
      });
      await ctx.db.insert("creditGrants", {
        userId: uid,
        amount: 15,
        reason: "purchase" as const,
        stripePaymentIntentId: "pi_clamp",
        createdAt: 100,
      });
      await ctx.db.insert("purchaseSettlements", {
        stripePaymentIntentId: "pi_clamp",
        stripeCheckoutSessionId: "cs_clamp",
        pendingCheckoutId: null,
        userId: uid,
        priceId: "price_test_starter",
        creditsGranted: 15,
        amountUsd: 5,
        currency: "usd",
        creditGrantCreatedAt: 100,
        revenueEventCreatedAt: 100,
        createdAt: 100,
      });
      return uid;
    });

    const r = await t.mutation(internal.creditPackPurchase.onStripeRefundCreated, {
      refund: { id: "re_c", payment_intent: "pi_clamp", amount: 500, created: 1 },
    });
    expect(r.outcome).toBe("refunded");
    if (r.outcome !== "refunded") throw new Error("expected refunded");
    expect(r.creditsClawedBack).toBe(3);

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.credits).toBe(0);
  });
});

describe("creditPackPurchase purgeUserPurchaseStateForQa", () => {
  it("removes module rows for one user only", async () => {
    const t = convexTest(schema, modules);
    const { userA, userB } = await t.run(async (ctx) => {
      const a = await ctx.db.insert("users", { email: "qa-a@celstate.test", credits: 10 });
      const b = await ctx.db.insert("users", { email: "qa-b@celstate.test", credits: 20 });
      await ctx.db.insert("pendingCheckouts", {
        userId: a,
        priceId: "price_test_starter",
        status: "pending" as const,
        createdAt: 1,
      });
      await ctx.db.insert("purchaseSettlements", {
        stripePaymentIntentId: "pi_a",
        stripeCheckoutSessionId: "cs_a",
        pendingCheckoutId: null,
        userId: a,
        priceId: "price_test_starter",
        creditsGranted: 15,
        amountUsd: 5,
        currency: "usd",
        creditGrantCreatedAt: 1,
        revenueEventCreatedAt: 1,
        createdAt: 1,
      });
      await ctx.db.insert("creditGrants", {
        userId: a,
        amount: 15,
        reason: "purchase" as const,
        stripePaymentIntentId: "pi_a",
        createdAt: 1,
      });
      await ctx.db.insert("creditGrants", {
        userId: b,
        amount: 5,
        reason: "purchase" as const,
        stripePaymentIntentId: "pi_b",
        createdAt: 1,
      });
      return { userA: a, userB: b };
    });

    const counts = await t.mutation(internal.creditPackPurchase.purgeUserPurchaseStateForQa, {
      runnerSecret: RUNNER_SECRET,
      userId: userA,
    });

    expect(counts).toMatchObject({
      pendingCheckoutsRemoved: 1,
      purchaseSettlementsRemoved: 1,
      purchaseCreditGrantsRemoved: 1,
    });

    const grantsB = await t.run(async (ctx) =>
      ctx.db
        .query("creditGrants")
        .withIndex("by_user", (q) => q.eq("userId", userB))
        .collect(),
    );
    expect(grantsB).toHaveLength(1);
  });
});
