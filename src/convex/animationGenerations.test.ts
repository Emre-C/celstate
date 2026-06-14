/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";
import { ANIMATION_GENERATION_CONFIG } from "./lib/config.js";

process.env.SITE_URL ??= "http://127.0.0.1:4174";
process.env.AUTH_GOOGLE_ID ??= "test-google-client-id";
process.env.AUTH_GOOGLE_SECRET ??= "test-google-client-secret";
process.env.ANIMATION_WORKER_SECRET ??= "test-animation-worker-secret";

const modules = import.meta.glob([
  "/src/convex/**/*.ts",
  "!/src/convex/**/*.test.ts",
]);

function createTest() {
  return convexTest(schema, modules);
}

async function seedUser(t: ReturnType<typeof createTest>, credits = 0) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      credits,
      email: "animation-generation@celstate.test",
    })
  );
}

describe("animation generation requests", () => {
  it("creates a living UI runtime request without charging image credits", async () => {
    const t = createTest();
    const userId = await seedUser(t, 0);

    const animationGenerationId = await t.mutation(
      internal.animationGenerations.requestAnimationGenerationForUser,
      {
        brandInputs: {
          channelName: "Celstate",
          colors: ["#C2410C", "warm cream"],
        },
        aspectRatio: "1:1",
        destination: "react_native_runtime",
        durationSeconds: 2,
        prompt: "swaying leaf icon",
        useCase: "small_accent",
        userId,
      },
    );

    const row = await t.run((ctx) => ctx.db.get(animationGenerationId));
    const user = await t.run((ctx) => ctx.db.get(userId));

    expect(user?.credits).toBe(0);
    expect(row).toMatchObject({
      aspectRatio: "1:1",
      creditsCost: 0,
      destination: "react_native_runtime",
      durationSeconds: 2,
      prompt: "swaying leaf icon",
      retryCount: 0,
      status: "intake",
      useCase: "small_accent",
      userId,
    });
    expect(row?.aspectRatio).toBe("1:1");
    expect(row?.productionBrief).toContain("React-Native-ready");
    expect(row?.productionBrief).toContain("transparent living small-accent asset");
  });

  it("does not let manual intake requests exhaust active pipeline slots", async () => {
    const t = createTest();
    const userId = await seedUser(t, 0);

    for (let i = 0; i < ANIMATION_GENERATION_CONFIG.maxActiveAnimationGenerations + 1; i++) {
      await t.mutation(internal.animationGenerations.requestAnimationGenerationForUser, {
        destination: "react_native_runtime",
        prompt: `stream alert ${i}`,
        useCase: "small_accent",
        userId,
      });
    }

    const rows = await t.run((ctx) =>
      ctx.db
        .query("animationGenerations")
        .withIndex("by_user_created", (q) => q.eq("userId", userId))
        .collect()
    );
    expect(rows).toHaveLength(ANIMATION_GENERATION_CONFIG.maxActiveAnimationGenerations + 1);
    expect(rows.every((row) => row.status === "intake")).toBe(true);
  });

  it("rate limits free validation intake without using active worker status", async () => {
    const t = createTest();
    const userId = await seedUser(t, 0);

    for (let i = 0; i < ANIMATION_GENERATION_CONFIG.maxRequestsPerWindow; i++) {
      await t.mutation(internal.animationGenerations.requestAnimationGenerationForUser, {
        destination: "react_native_runtime",
        prompt: `validation request ${i}`,
        useCase: "small_accent",
        userId,
      });
    }

    await expect(
      t.mutation(internal.animationGenerations.requestAnimationGenerationForUser, {
        destination: "react_native_runtime",
        prompt: "one request too many",
        useCase: "small_accent",
        userId,
      }),
    ).rejects.toThrow(/Too many animation requests/);
  });

  it("rejects unsupported aspect ratio or duration", async () => {
    const t = createTest();
    const userId = await seedUser(t, 3);

    await expect(
      t.mutation(internal.animationGenerations.requestAnimationGenerationForUser, {
        aspectRatio: "1:1",
        destination: "runtime_bundle",
        durationSeconds: 5,
        prompt: "logo sting",
        useCase: "button_overlay",
        userId,
      }),
    ).rejects.toThrow(/Unsupported animation aspect ratio|Unsupported animation duration/);
  });

  it("keeps terminal transitions idempotent", async () => {
    const t = createTest();
    const userId = await seedUser(t, 3);

    const animationGenerationId = await t.mutation(
      internal.animationGenerations.requestAnimationGenerationForUser,
      {
        destination: "runtime_bundle",
        prompt: "podcast lower third",
        useCase: "interactive_control",
        userId,
      },
    );

    await t.mutation(internal.animationGenerations.failAnimationGeneration, {
      animationGenerationId,
      error: "Manual QA rejected the animation.",
    });
    await t.mutation(internal.animationGenerations.markStage, {
      animationGenerationId,
      expectedStatus: "intake",
      status: "exporting",
    });

    const row = await t.run((ctx) => ctx.db.get(animationGenerationId));
    expect(row).toMatchObject({
      error: "Manual QA rejected the animation.",
      status: "failed",
    });
  });

  it("ignores stale stage transitions that do not match the observed status", async () => {
    const t = createTest();
    const userId = await seedUser(t, 3);

    const animationGenerationId = await t.mutation(
      internal.animationGenerations.requestAnimationGenerationForUser,
      {
        destination: "react_native_runtime",
        prompt: "logo sting",
        useCase: "button_overlay",
        userId,
      },
    );

    await t.mutation(internal.animationGenerations.markStage, {
      animationGenerationId,
      expectedStatus: "queued",
      status: "exporting",
    });

    const row = await t.run((ctx) => ctx.db.get(animationGenerationId));
    expect(row?.status).toBe("intake");
  });

  it("does not allow production completion without passing QA artifacts", async () => {
    const t = createTest();
    const userId = await seedUser(t, 3);

    const animationGenerationId = await t.mutation(
      internal.animationGenerations.requestAnimationGenerationForUser,
      {
        destination: "runtime_bundle",
        prompt: "podcast lower third",
        useCase: "interactive_control",
        userId,
      },
    );

    await expect(
      t.mutation(internal.animationGenerations.completeAnimationGeneration, {
        animationGenerationId,
        expectedStatus: "intake",
      }),
    ).rejects.toThrow(/passing animation QA/);
  });

  it("lets the media worker atomically claim one intake request", async () => {
    const t = createTest();
    const userId = await seedUser(t, 3);

    const firstId = await t.mutation(
      internal.animationGenerations.requestAnimationGenerationForUser,
      {
        destination: "react_native_runtime",
        prompt: "first stream alert",
        useCase: "small_accent",
        userId,
      },
    );
    const secondId = await t.mutation(
      internal.animationGenerations.requestAnimationGenerationForUser,
      {
        destination: "react_native_runtime",
        prompt: "second stream alert",
        useCase: "small_accent",
        userId,
      },
    );

    const claimed = await t.mutation(
      api.animationGenerations.claimAnimationGenerationForWorker,
      { workerSecret: "test-animation-worker-secret" },
    );
    const first = await t.run((ctx) => ctx.db.get(firstId));
    const second = await t.run((ctx) => ctx.db.get(secondId));

    expect(claimed?._id).toBe(firstId);
    expect(first?.status).toBe("generating_reference");
    expect(first?.statusMessage).toBe("Designing the motion asset.");
    expect(second?.status).toBe("intake");
  });

  it("requeues transient worker failures back to intake until maxWorkerRetries", async () => {
    const t = createTest();
    const userId = await seedUser(t, 0);
    const animationGenerationId = await t.mutation(
      internal.animationGenerations.requestAnimationGenerationForUser,
      {
        destination: "react_native_runtime",
        prompt: "swaying leaf icon",
        useCase: "small_accent",
        userId,
      },
    );

    await t.mutation(api.animationGenerations.claimAnimationGenerationForWorker, {
      workerSecret: "test-animation-worker-secret",
    });

    const requeued = await t.mutation(api.animationGenerations.requeueAnimationGenerationForWorker, {
      animationGenerationId,
      workerError: '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}',
      workerSecret: "test-animation-worker-secret",
    });
    expect(requeued).toBe("requeued");

    const row = await t.run((ctx) => ctx.db.get(animationGenerationId));
    expect(row?.status).toBe("intake");
    expect(row?.retryCount).toBe(1);
  });

  it("rejects media worker claims without the configured secret", async () => {
    const t = createTest();
    const userId = await seedUser(t, 3);
    await t.mutation(internal.animationGenerations.requestAnimationGenerationForUser, {
      destination: "react_native_runtime",
      prompt: "stream alert",
      useCase: "small_accent",
      userId,
    });

    await expect(
      t.mutation(api.animationGenerations.claimAnimationGenerationForWorker, {
        workerSecret: "wrong-secret",
      }),
    ).rejects.toThrow(/Invalid animation worker secret/);
  });
});
