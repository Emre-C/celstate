/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";

process.env.SITE_URL ??= "http://127.0.0.1:4174";
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret";
process.env.AUTH_GOOGLE_ID ??= "test-google-client-id";
process.env.AUTH_GOOGLE_SECRET ??= "test-google-client-secret";

const modules = import.meta.glob([
  "/src/convex/**/*.ts",
  "!/src/convex/**/*.test.ts",
]);

type SeedGenerationArgs = {
  stage: "white_background" | "black_background" | "finalizing";
  statusMessage?: string;
};

async function seedGeneration(args: SeedGenerationArgs) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "generation-durability@celstate.test",
      credits: 0,
    });
    const generationId = await ctx.db.insert("generations", {
      aspectRatio: "1:1",
      createdAt: 100,
      creditsCost: 1,
      lastProgressAt: 100,
      prompt: "editorial mascot",
      retryCount: 0,
      status: "generating" as const,
      stage: args.stage,
      statusMessage: args.statusMessage,
      userId,
      whiteBgRetryCount: 0,
      blackBgRetryCount: 0,
      finalizeRetryCount: 0,
    });

    return { generationId, userId };
  });

  return { t, ...ids };
}

describe("generation mutation durability", () => {
  it("allows a finalizing-stage QA decision to roll back to white_background", async () => {
    const { generationId, t } = await seedGeneration({ stage: "finalizing" });

    await t.mutation(internal.generations.scheduleStageRetry, {
      generationId,
      expectedStage: "finalizing",
      retryCount: 1,
      retryInstruction: "rerender both backgrounds",
      downstreamRetryInstruction: "keep the black pass aligned",
      stage: "white_background",
    });

    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation).toMatchObject({
      stage: "white_background",
      status: "generating",
      retryCount: 1,
      whiteBgRetryCount: 1,
      whiteBgRetryInstruction: "rerender both backgrounds",
      blackBgRetryInstruction: "keep the black pass aligned",
    });
  });

  it("rejects stale retry decisions whose observed stage no longer matches", async () => {
    const { generationId, t } = await seedGeneration({ stage: "black_background" });

    await t.mutation(internal.generations.scheduleStageRetry, {
      generationId,
      retryCount: 1,
      retryInstruction: "stale white retry",
      stage: "white_background",
    });

    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation).toMatchObject({
      stage: "black_background",
      retryCount: 0,
      whiteBgRetryCount: 0,
    });
  });

  it("guards status updates by the stage that produced the progress event", async () => {
    const { generationId, t } = await seedGeneration({
      stage: "finalizing",
      statusMessage: "Preparing final image…",
    });

    await t.mutation(internal.generations.updateStatusMessage, {
      generationId,
      stage: "white_background",
      statusMessage: "stale white progress",
    });

    await expect(t.run((ctx) => ctx.db.get(generationId))).resolves.toMatchObject({
      stage: "finalizing",
      lastProgressAt: 100,
      statusMessage: "Preparing final image…",
    });

    await t.mutation(internal.generations.updateStatusMessage, {
      generationId,
      stage: "finalizing",
      statusMessage: "Verifying transparency…",
    });

    await expect(t.run((ctx) => ctx.db.get(generationId))).resolves.toMatchObject({
      stage: "finalizing",
      statusMessage: "Verifying transparency…",
    });
  });

  it("does not mutate completed rows from a stale status update", async () => {
    const { generationId, t } = await seedGeneration({ stage: "finalizing" });

    await t.run(async (ctx) => {
      await ctx.db.patch(generationId, {
        completedAt: 200,
        stage: undefined,
        status: "complete",
        statusMessage: undefined,
      });
    });

    await t.mutation(internal.generations.updateStatusMessage, {
      generationId,
      stage: "finalizing",
      statusMessage: "stale finalize progress",
    });

    await expect(t.run((ctx) => ctx.db.get(generationId))).resolves.toMatchObject({
      completedAt: 200,
      lastProgressAt: 100,
      status: "complete",
    });
  });
});
