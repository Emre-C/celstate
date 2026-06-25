/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import posthogTest from "@posthog/convex/test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob([
  "/src/convex/**/*.ts",
  "!/src/convex/**/*.test.ts",
]);

function createTest() {
  const t = convexTest(schema, modules);
  posthogTest.register(t);
  return t;
}

const identity = {
  tokenIdentifier: "https://clerk.test/|lottie_user",
  subject: "lottie_user",
  email: "lottie@celstate.test",
  emailVerified: true,
};

function passValidation() {
  return {
    decision: "pass" as const,
    errors: [],
    warnings: [],
    version: "lottie-v1",
  };
}

describe("lottieGenerations", () => {
  it("queues a zero-credit Lottie generation for the current user", async () => {
    const t = createTest();
    const asUser = t.withIdentity(identity);

    const id = await asUser.mutation(api.lottieGenerations.requestLottieGeneration, {
      aspectRatio: "1:1",
      durationSeconds: 4,
      grounding: "<svg><path d=\"M0 0\"/></svg>",
      prompt: "Draw a terracotta leaf.",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.status).toBe("queued");
    expect(row?.creditsCost).toBe(0);
    expect(row?.attemptCount).toBe(0);
    expect(row?.grounding).toContain("<svg");

    const list = await asUser.query(api.lottieGenerations.getByUserWithUrls, {});
    expect(list).toHaveLength(1);
    expect(list[0]?.lottieUrl).toBeNull();
  });

  it("validates request input and active limits", async () => {
    const t = createTest();
    const asUser = t.withIdentity(identity);
    const user = await asUser.mutation(api.users.storeUser, {});

    await expect(asUser.mutation(api.lottieGenerations.requestLottieGeneration, {
      aspectRatio: "2:1",
      durationSeconds: 4,
      prompt: "bad aspect",
    })).rejects.toThrow(/Unsupported Lottie aspect ratio/);

    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("lottieGenerations", {
          userId: user._id,
          prompt: `active ${i}`,
          status: "queued",
          aspectRatio: "1:1",
          durationSeconds: 4,
          fps: 60,
          createdAt: i + 1,
          attemptCount: 0,
          creditsCost: 0,
        });
      }
    });

    await expect(asUser.mutation(api.lottieGenerations.requestLottieGeneration, {
      aspectRatio: "1:1",
      durationSeconds: 4,
      prompt: "one too many",
    })).rejects.toThrow(/Too many Lottie generations/);
  });

  it("applies completion only from the expected status", async () => {
    const t = createTest();
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { email: "cas@celstate.test", credits: 1 });
    });
    const lottieGenerationId = await t.run(async (ctx) => {
      return await ctx.db.insert("lottieGenerations", {
        userId,
        prompt: "cas",
        status: "generating",
        aspectRatio: "1:1",
        durationSeconds: 4,
        fps: 60,
        createdAt: 1,
        attemptCount: 1,
        creditsCost: 0,
      });
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["{}"], { type: "application/json" }));
    });

    await t.mutation(internal.lottieGenerations.completeLottieGeneration, {
      expectedStatus: "repairing",
      lottieGenerationId,
      lottieStorageId: storageId,
      validation: passValidation(),
    });

    await t.run(async (ctx) => {
      expect((await ctx.db.get(lottieGenerationId))?.status).toBe("generating");
    });

    await t.mutation(internal.lottieGenerations.completeLottieGeneration, {
      expectedStatus: "generating",
      lottieGenerationId,
      lottieStorageId: storageId,
      validation: passValidation(),
    });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(lottieGenerationId);
      expect(row?.status).toBe("complete");
      expect(row?.lottieStorageId).toBe(storageId);
    });
  });

  it("reclaims stale active lottie generations and refunds credits", async () => {
    const t = createTest();
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "stale@celstate.test", credits: 2 }),
    );
    const staleId = await t.run(async (ctx) =>
      ctx.db.insert("lottieGenerations", {
        userId,
        prompt: "stuck",
        status: "generating",
        aspectRatio: "1:1",
        durationSeconds: 4,
        fps: 60,
        createdAt: 1,
        lastProgressAt: 1,
        attemptCount: 1,
        creditsCost: 1,
      }),
    );
    const freshId = await t.run(async (ctx) =>
      ctx.db.insert("lottieGenerations", {
        userId,
        prompt: "in flight",
        status: "generating",
        aspectRatio: "1:1",
        durationSeconds: 4,
        fps: 60,
        createdAt: Date.now(),
        lastProgressAt: Date.now(),
        attemptCount: 1,
        creditsCost: 1,
      }),
    );

    await t.mutation(internal.lottieGenerations.cleanupStaleLottieGenerations, {});

    await t.run(async (ctx) => {
      const stale = await ctx.db.get(staleId);
      expect(stale?.status).toBe("failed");
      expect(stale?.creditRefundedAt).toBeDefined();
      const fresh = await ctx.db.get(freshId);
      expect(fresh?.status).toBe("generating");
      const user = await ctx.db.get(userId);
      expect(user?.credits).toBe(3);
    });
  });

  it("refunds credits exactly once when failing a charged generation", async () => {
    const t = createTest();
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "refund@celstate.test", credits: 0 }),
    );
    const id = await t.run(async (ctx) =>
      ctx.db.insert("lottieGenerations", {
        userId,
        prompt: "charge",
        status: "generating",
        aspectRatio: "1:1",
        durationSeconds: 4,
        fps: 60,
        createdAt: 1,
        lastProgressAt: 1,
        attemptCount: 1,
        creditsCost: 2,
      }),
    );

    await t.mutation(internal.lottieGenerations.failLottieGeneration, {
      error: "boom",
      lottieGenerationId: id,
    });
    await t.mutation(internal.lottieGenerations.failLottieGeneration, {
      error: "boom again",
      lottieGenerationId: id,
    });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(id);
      expect(row?.status).toBe("failed");
      const user = await ctx.db.get(userId);
      expect(user?.credits).toBe(2);
    });
  });
});
