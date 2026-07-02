/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob([
  "/src/convex/**/*.ts",
  "!/src/convex/**/*.test.ts",
]);

function createTest() {
  return convexTest(schema, modules);
}

const IDENTITY = {
  tokenIdentifier: "https://clerk.test/|feedback_user",
  subject: "feedback_user",
  email: "feedback@celstate.test",
  emailVerified: true,
};

async function seedUserAndGeneration() {
  const t = createTest();
  const asUser = t.withIdentity(IDENTITY);

  const user = await asUser.mutation(api.users.storeUser, {});

  const generationId = await t.run(async (ctx) => {
    return await ctx.db.insert("generations", {
      userId: user._id,
      prompt: "A test phoenix",
      status: "complete",
      creditsCost: 1,
      aspectRatio: "1:1",
      createdAt: Date.now(),
      completedAt: Date.now(),
    });
  });

  return { t, asUser, user, generationId };
}

describe("Generation feedback — generations.submitFeedback", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "test_key");
  });

  it("inserts a new feedback row on first submission", async () => {
    const { asUser, generationId } = await seedUserAndGeneration();

    const result = await asUser.mutation(api.generations.submitFeedback, {
      generationId: generationId as Id<"generations">,
      rating: "up",
    });

    expect(result.ok).toBe(true);
    expect(result.alreadySubmitted).toBe(false);
  });

  it("updates rating when user changes from up to down", async () => {
    const { asUser, generationId } = await seedUserAndGeneration();

    await asUser.mutation(api.generations.submitFeedback, {
      generationId: generationId as Id<"generations">,
      rating: "up",
    });

    const result = await asUser.mutation(api.generations.submitFeedback, {
      generationId: generationId as Id<"generations">,
      rating: "down",
    });

    expect(result.ok).toBe(true);
    expect(result.alreadySubmitted).toBe(false);

    const feedback = await asUser.query(api.generations.getFeedbackForGeneration, {
      generationId: generationId as Id<"generations">,
    });

    expect(feedback?.rating).toBe("down");
  });

  it("returns alreadySubmitted when same rating is submitted again", async () => {
    const { asUser, generationId } = await seedUserAndGeneration();

    await asUser.mutation(api.generations.submitFeedback, {
      generationId: generationId as Id<"generations">,
      rating: "up",
    });

    const result = await asUser.mutation(api.generations.submitFeedback, {
      generationId: generationId as Id<"generations">,
      rating: "up",
    });

    expect(result.ok).toBe(true);
    expect(result.alreadySubmitted).toBe(true);
  });

  it("rejects feedback from a different user", async () => {
    const { t, generationId } = await seedUserAndGeneration();

    const asOther = t.withIdentity({
      tokenIdentifier: "https://clerk.test/|other_user",
      subject: "other_user",
      email: "other@celstate.test",
      emailVerified: true,
    });

    await expect(
      asOther.mutation(api.generations.submitFeedback, {
        generationId: generationId as Id<"generations">,
        rating: "up",
      }),
    ).rejects.toThrow();
  });

  it("preserves createdAt when rating is changed", async () => {
    const { t, asUser, generationId } = await seedUserAndGeneration();

    await asUser.mutation(api.generations.submitFeedback, {
      generationId: generationId as Id<"generations">,
      rating: "up",
    });

    const before = await asUser.query(api.generations.getFeedbackForGeneration, {
      generationId: generationId as Id<"generations">,
    });
    expect(before?.rating).toBe("up");
    const originalCreatedAt = before!.createdAt;

    await t.run(async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    await asUser.mutation(api.generations.submitFeedback, {
      generationId: generationId as Id<"generations">,
      rating: "down",
    });

    const after = await asUser.query(api.generations.getFeedbackForGeneration, {
      generationId: generationId as Id<"generations">,
    });
    expect(after?.rating).toBe("down");
    expect(after?.createdAt).toBe(originalCreatedAt);
  });

  it("returns null from getFeedbackForGeneration when no feedback exists", async () => {
    const { asUser, generationId } = await seedUserAndGeneration();

    const feedback = await asUser.query(api.generations.getFeedbackForGeneration, {
      generationId: generationId as Id<"generations">,
    });

    expect(feedback).toBeNull();
  });
});
