/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { CANARY_PRINCIPAL_CONFIG } from "../lib/production-confidence.js";
import posthogTest from "@posthog/convex/test";
import schema from "./schema.js";

const modules = import.meta.glob([
  "/src/convex/**/*.ts",
  "!/src/convex/**/*.test.ts",
]);

const RUNNER = "provision-runner-test-secret";

beforeEach(() => {
  vi.stubEnv("VERIFICATION_RUNNER_SECRET", RUNNER);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function createTest() {
  const t = convexTest(schema, modules);
  posthogTest.register(t);
  return t;
}

describe("WorkOS provisioning — users.storeUser", () => {
  it("inserts a new user and binds workosUserId from identity.subject", async () => {
    const t = createTest();
    const asUser = t.withIdentity({
      tokenIdentifier: "https://api.workos.com/|user_new_1",
      subject: "user_new_1",
      email: "new-user@celstate.test",
      emailVerified: true,
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc.email).toBe("new-user@celstate.test");
    expect(doc.workosUserId).toBe("user_new_1");
    expect(doc.tokenIdentifier).toBe("https://api.workos.com/|user_new_1");
  });

  it("adopts an existing row matched by email and updates token + workosUserId", async () => {
    const t = createTest();
    const legacyId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "legacy@celstate.test",
        credits: 42,
        tokenIdentifier: "https://legacy.example/|old_sub",
      });
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "https://api.workos.com/|user_workos_2",
      subject: "user_workos_2",
      email: "legacy@celstate.test",
      emailVerified: true,
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc._id).toEqual(legacyId);
    expect(doc.workosUserId).toBe("user_workos_2");
    expect(doc.tokenIdentifier).toBe("https://api.workos.com/|user_workos_2");
    expect(doc.credits).toBe(42);
  });

  it("patches workosUserId when the same token returns a new subject (re-bind)", async () => {
    const t = createTest();
    const tokenId = "https://api.workos.com/|stable_token";

    const asFirst = t.withIdentity({
      tokenIdentifier: tokenId,
      subject: "user_sub_a",
      email: "rebind@celstate.test",
      emailVerified: true,
    });
    await asFirst.mutation(api.users.storeUser, {});

    const asSecond = t.withIdentity({
      tokenIdentifier: tokenId,
      subject: "user_sub_b",
      email: "rebind@celstate.test",
      emailVerified: true,
    });
    const doc = await asSecond.mutation(api.users.storeUser, {});
    expect(doc.workosUserId).toBe("user_sub_b");
  });

  it("prefers by_workos_user over email when both could apply", async () => {
    const t = createTest();
    const workosRow = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        workosUserId: "user_stable_w",
        email: "first@celstate.test",
        credits: 100,
        tokenIdentifier: "https://api.workos.com/|t_a",
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "second@celstate.test",
        credits: 7,
        tokenIdentifier: "https://legacy/|orphan",
      });
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "https://api.workos.com/|t_b",
      subject: "user_stable_w",
      email: "second@celstate.test",
      emailVerified: true,
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc._id).toEqual(workosRow);
    expect(doc.credits).toBe(100);
    expect(doc.email).toBe("second@celstate.test");
    expect(doc.tokenIdentifier).toBe("https://api.workos.com/|t_b");
  });

  it("updates token on returning workos subject even when token changes", async () => {
    const t = createTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        workosUserId: "user_rot",
        email: "rot@celstate.test",
        credits: 3,
        tokenIdentifier: "https://api.workos.com/|old_jti",
      });
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "https://api.workos.com/|new_jti",
      subject: "user_rot",
      email: "rot@celstate.test",
      emailVerified: true,
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc.workosUserId).toBe("user_rot");
    expect(doc.tokenIdentifier).toBe("https://api.workos.com/|new_jti");
  });

  it("normalizes email to lowercase for storage and adoption", async () => {
    const t = createTest();
    const legacyId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "mixed@celstate.test",
        credits: 1,
        tokenIdentifier: "legacy",
      });
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "https://api.workos.com/|sub_m",
      subject: "sub_m",
      email: "MiXeD@Celstate.TEST",
      emailVerified: true,
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc._id).toEqual(legacyId);
    expect(doc.email).toBe("mixed@celstate.test");
  });

  it("allows provisioning when email and emailVerified are absent from identity", async () => {
    const t = createTest();
    const asUser = t.withIdentity({
      tokenIdentifier: "https://api.workos.com/user_management/client_x|bare_sub",
      subject: "bare_sub",
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc.workosUserId).toBe("bare_sub");
    expect(doc.email).toBeUndefined();
  });

  it("rejects identity with explicit emailVerified false", async () => {
    const t = createTest();
    const asUser = t.withIdentity({
      tokenIdentifier: "https://api.workos.com/|unverified",
      subject: "unverified",
      email: "u@celstate.test",
      emailVerified: false,
    });

    await expect(asUser.mutation(api.users.storeUser, {})).rejects.toThrow(
      /Email must be verified/,
    );
  });

  /**
   * Security contract: email-based adoption is allowed when emailVerified is
   * absent or true, but NOT when explicitly false. This supports WorkOS social
   * account linking (which is email-based) while blocking takeover of rows by
   * unverified identities. A newly-provisioned user that adopts an existing row
   * inherits its credits and other state.
   */
  it("allows email adoption when emailVerified is absent (WorkOS minimal token)", async () => {
    const t = createTest();
    const legacyId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "adopt@celstate.test",
        credits: 42,
        tokenIdentifier: "legacy",
      });
    });

    // WorkOS default access tokens may omit email/emailVerified entirely.
    const asUser = t.withIdentity({
      tokenIdentifier: "https://api.workos.com/|adopter",
      subject: "adopter",
      email: "adopt@celstate.test",
      // emailVerified intentionally absent
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc._id).toEqual(legacyId);
    expect(doc.credits).toBe(42);
    expect(doc.workosUserId).toBe("adopter");
  });
});

describe("canary principal bootstrap — verification.upsertCanaryPrincipal", () => {
  it("binds CANARY_AUTH when exactly one user exists for the canonical email", async () => {
    const t = createTest();
    const email = CANARY_PRINCIPAL_CONFIG.CANARY_AUTH.email;

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email,
        credits: 1,
        workosUserId: "canary_workos_subject",
        tokenIdentifier: "https://api.workos.com/|canary_workos_subject",
      });
    });

    const id = await t.mutation(internal.verification.upsertCanaryPrincipal, {
      runnerSecret: RUNNER,
      principalId: "CANARY_AUTH",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.principalId).toBe("CANARY_AUTH");
    expect(row?.workosUserId).toBe("canary_workos_subject");
  });

  it("rejects duplicate app users with the canary email", async () => {
    const t = createTest();
    const email = CANARY_PRINCIPAL_CONFIG.CANARY_AUTH.email;

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email,
        credits: 1,
        workosUserId: "w1",
        tokenIdentifier: "t1",
      });
      await ctx.db.insert("users", {
        email,
        credits: 1,
        workosUserId: "w2",
        tokenIdentifier: "t2",
      });
    });

    await expect(
      t.mutation(internal.verification.upsertCanaryPrincipal, {
        runnerSecret: RUNNER,
        principalId: "CANARY_AUTH",
      }),
    ).rejects.toThrow(/Multiple app users matched/);
  });

  it("falls back to workosUserId lookup when user row lacks email and patches email", async () => {
    const t = createTest();
    const email = CANARY_PRINCIPAL_CONFIG.CANARY_AUTH.email;
    const workosUserId = "canary_no_email";

    // First provisioning requires the user to have an email.
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email,
        workosUserId,
        credits: 1,
        tokenIdentifier: "https://api.workos.com/|" + workosUserId,
      });
    });

    const firstId = await t.mutation(internal.verification.upsertCanaryPrincipal, {
      runnerSecret: RUNNER,
      principalId: "CANARY_AUTH",
    });

    // Now remove the email from the user row to simulate the minimal-token case.
    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_workos_user", (q) => q.eq("workosUserId", workosUserId))
        .first();
      if (user) {
        await ctx.db.patch(user._id, { email: undefined });
      }
    });

    // Second provisioning should succeed via workosUserId fallback and patch email.
    const secondId = await t.mutation(internal.verification.upsertCanaryPrincipal, {
      runnerSecret: RUNNER,
      principalId: "CANARY_AUTH",
    });
    expect(secondId).toEqual(firstId);

    const userAfter = await t.run(async (ctx) => {
      return await ctx.db
        .query("users")
        .withIndex("by_workos_user", (q) => q.eq("workosUserId", workosUserId))
        .first();
    });
    expect(userAfter?.email).toBe(email);
  });
});
