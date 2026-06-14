/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { CANARY_PRINCIPAL_CONFIG } from "../lib/production-confidence/index.js";
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

describe("Clerk provisioning — users.storeUser", () => {
  it("inserts a new user and binds clerkUserId from identity.subject", async () => {
    const t = createTest();
    const asUser = t.withIdentity({
      tokenIdentifier: "https://clerk.test/|user_new_1",
      subject: "user_new_1",
      email: "new-user@celstate.test",
      emailVerified: true,
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc.email).toBe("new-user@celstate.test");
    expect(doc.clerkUserId).toBe("user_new_1");
    expect(doc.tokenIdentifier).toBe("https://clerk.test/|user_new_1");
  });

  it("adopts an existing row matched by email and updates token + clerkUserId", async () => {
    const t = createTest();
    const legacyId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "legacy@celstate.test",
        credits: 42,
        tokenIdentifier: "https://legacy.example/|old_sub",
      });
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "https://clerk.test/|user_clerk_2",
      subject: "user_clerk_2",
      email: "legacy@celstate.test",
      emailVerified: true,
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc._id).toEqual(legacyId);
    expect(doc.clerkUserId).toBe("user_clerk_2");
    expect(doc.tokenIdentifier).toBe("https://clerk.test/|user_clerk_2");
    expect(doc.credits).toBe(42);
  });

  it("patches clerkUserId when the same token returns a new subject (re-bind)", async () => {
    const t = createTest();
    const tokenId = "https://clerk.test/|stable_token";

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
    expect(doc.clerkUserId).toBe("user_sub_b");
  });

  it("adopts legacy email account over a blank Clerk shell row", async () => {
    const t = createTest();
    const legacyId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "emre@celstate.test",
        credits: 7,
        name: "Emre",
        tokenIdentifier: "https://legacy.convex.site|old_session",
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkUserId: "user_clerk_shell",
        credits: 3,
        tokenIdentifier: "https://clerk.test/|user_clerk_shell",
      });
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "https://clerk.test/|user_clerk_shell",
      subject: "user_clerk_shell",
      email: "emre@celstate.test",
      emailVerified: true,
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc._id).toEqual(legacyId);
    expect(doc.credits).toBe(7);
    expect(doc.clerkUserId).toBe("user_clerk_shell");
    expect(doc.tokenIdentifier).toBe("https://clerk.test/|user_clerk_shell");

    const me = await asUser.query(api.users.getMe, {});
    expect(me?._id).toEqual(legacyId);
    expect(me?.credits).toBe(7);
  });

  it("consolidates a cutover shell into the legacy account, repointing its records", async () => {
    const t = createTest();
    const { legacyId, shellId, genId, animId } = await t.run(async (ctx) => {
      const legacyId = await ctx.db.insert("users", {
        email: "merge@celstate.test",
        credits: 7,
        tokenIdentifier: "https://legacy.convex.site|old_session",
      });
      const shellId = await ctx.db.insert("users", {
        clerkUserId: "user_shell_merge",
        credits: 3,
        tokenIdentifier: "https://clerk.test/|user_shell_merge",
      });
      // A record created while the user was stranded on the shell must follow
      // them onto the canonical account.
      const genId = await ctx.db.insert("generations", {
        userId: shellId,
        prompt: "stranded",
        status: "complete",
        creditsCost: 1,
        aspectRatio: "1:1",
        createdAt: 1,
      });
      const animId = await ctx.db.insert("animationGenerations", {
        userId: shellId,
        prompt: "stranded-anim",
        useCase: "small_accent",
        destination: "web_runtime",
        status: "complete",
        aspectRatio: "1:1",
        durationSeconds: 2,
        creditsCost: 1,
        retryCount: 0,
        createdAt: 1,
      });
      return { legacyId, shellId, genId, animId };
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "https://clerk.test/|user_shell_merge",
      subject: "user_shell_merge",
      email: "merge@celstate.test",
      emailVerified: true,
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc._id).toEqual(legacyId);
    expect(doc.credits).toBe(7); // shell's default grant is discarded, not summed
    expect(doc.clerkUserId).toBe("user_shell_merge");

    await t.run(async (ctx) => {
      expect(await ctx.db.get(shellId)).toBeNull(); // shell consolidated away
      expect((await ctx.db.get(genId))?.userId).toEqual(legacyId);
      expect((await ctx.db.get(animId))?.userId).toEqual(legacyId);
    });
  });

  it("prefers by_clerk_user over email when both could apply", async () => {
    const t = createTest();
    const clerkRow = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        clerkUserId: "user_stable_w",
        email: "first@celstate.test",
        credits: 100,
        tokenIdentifier: "https://clerk.test/|t_a",
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
      tokenIdentifier: "https://clerk.test/|t_b",
      subject: "user_stable_w",
      email: "second@celstate.test",
      emailVerified: true,
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc._id).toEqual(clerkRow);
    expect(doc.credits).toBe(100);
    expect(doc.email).toBe("second@celstate.test");
    expect(doc.tokenIdentifier).toBe("https://clerk.test/|t_b");
  });

  it("updates token on returning Clerk subject even when token changes", async () => {
    const t = createTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkUserId: "user_rot",
        email: "rot@celstate.test",
        credits: 3,
        tokenIdentifier: "https://clerk.test/|old_jti",
      });
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "https://clerk.test/|new_jti",
      subject: "user_rot",
      email: "rot@celstate.test",
      emailVerified: true,
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc.clerkUserId).toBe("user_rot");
    expect(doc.tokenIdentifier).toBe("https://clerk.test/|new_jti");
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
      tokenIdentifier: "https://clerk.test/|sub_m",
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
      tokenIdentifier: "https://clerk.test/user_management/client_x|bare_sub",
      subject: "bare_sub",
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc.clerkUserId).toBe("bare_sub");
    expect(doc.email).toBeUndefined();
  });

  it("rejects identity with explicit emailVerified false", async () => {
    const t = createTest();
    const asUser = t.withIdentity({
      tokenIdentifier: "https://clerk.test/|unverified",
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
   * absent or true, but NOT when explicitly false. This supports Clerk social
   * account linking (which is email-based) while blocking takeover of rows by
   * unverified identities. A newly-provisioned user that adopts an existing row
   * inherits its credits and other state.
   */
  it("allows email adoption when emailVerified is absent (Clerk minimal token)", async () => {
    const t = createTest();
    const legacyId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "adopt@celstate.test",
        credits: 42,
        tokenIdentifier: "legacy",
      });
    });

    // Clerk default access tokens may omit email/emailVerified entirely.
    const asUser = t.withIdentity({
      tokenIdentifier: "https://clerk.test/|adopter",
      subject: "adopter",
      email: "adopt@celstate.test",
      // emailVerified intentionally absent
    });

    const doc = await asUser.mutation(api.users.storeUser, {});
    expect(doc._id).toEqual(legacyId);
    expect(doc.credits).toBe(42);
    expect(doc.clerkUserId).toBe("adopter");
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
        clerkUserId: "user_canary_clerk_subject",
        tokenIdentifier: "https://clerk.test/|user_canary_clerk_subject",
      });
    });

    const id = await t.mutation(internal.verification.upsertCanaryPrincipal, {
      runnerSecret: RUNNER,
      principalId: "CANARY_AUTH",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.principalId).toBe("CANARY_AUTH");
    expect(row?.clerkUserId).toBe("user_canary_clerk_subject");
  });

  it("rejects duplicate app users with the canary email", async () => {
    const t = createTest();
    const email = CANARY_PRINCIPAL_CONFIG.CANARY_AUTH.email;

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email,
        credits: 1,
        clerkUserId: "w1",
        tokenIdentifier: "t1",
      });
      await ctx.db.insert("users", {
        email,
        credits: 1,
        clerkUserId: "w2",
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

  it("falls back to clerkUserId lookup when user row lacks email and patches email", async () => {
    const t = createTest();
    const email = CANARY_PRINCIPAL_CONFIG.CANARY_AUTH.email;
    const clerkUserId = "canary_no_email";

    // First provisioning requires the user to have an email.
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email,
        clerkUserId,
        credits: 1,
        tokenIdentifier: "https://clerk.test/|" + clerkUserId,
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
        .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
        .first();
      if (user) {
        await ctx.db.patch(user._id, { email: undefined });
      }
    });

    // Second provisioning should succeed via clerkUserId fallback and patch email.
    const secondId = await t.mutation(internal.verification.upsertCanaryPrincipal, {
      runnerSecret: RUNNER,
      principalId: "CANARY_AUTH",
    });
    expect(secondId).toEqual(firstId);

    const userAfter = await t.run(async (ctx) => {
      return await ctx.db
        .query("users")
        .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
        .first();
    });
    expect(userAfter?.email).toBe(email);
  });
});
