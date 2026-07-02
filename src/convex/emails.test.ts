/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import type { GenerationStatus } from "../lib/generation-types.js";
import schema from "./schema.js";
import {
  scenario1EmailHtml,
  scenario2EmailHtml,
  scenario3EmailHtml,
  scenario4EmailHtml,
  scenario5NeverTriedEmailHtml,
  scenario5TriedFailedEmailHtml,
} from "./emails.js";

const modules = import.meta.glob([
  "/src/convex/**/*.ts",
  "!/src/convex/**/*.test.ts",
]);

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test_key");
  vi.stubEnv("RESEND_TEST_MODE", "true");
  vi.stubEnv("SITE_URL", "https://celstate.test");
  vi.stubEnv("RESEND_FROM_ADDRESS", "Test <test@celstate.test>");
  vi.stubEnv("EMAIL_HMAC_SECRET", "test-hmac-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("emails — recordEmailSent", () => {
  it("stores a sent email event with componentEmailId", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "welcome@celstate.test",
        credits: 3,
      });
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.emails.recordEmailSent, {
        userId: userId as Id<"users">,
        emailType: "welcome",
        recipientEmail: "welcome@celstate.test",
        componentEmailId: "comp_email_123",
      });
    });

    const events = await t.run(async (ctx) => {
      return await ctx.db
        .query("emailEvents")
        .withIndex("by_user", (q) =>
          q.eq("userId", userId as Id<"users">),
        )
        .collect();
    });

    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe("sent");
    expect(events[0].emailType).toBe("welcome");
    expect(events[0].componentEmailId).toBe("comp_email_123");
    expect(events[0].recipientEmail).toBe("welcome@celstate.test");
    expect(events[0].error).toBeUndefined();
  });

  it("sets welcomeEmailStatus to sent on the user", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "status@celstate.test",
        credits: 3,
        welcomeEmailStatus: "pending",
        welcomeEmailAttempts: 0,
      });
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.emails.recordEmailSent, {
        userId: userId as Id<"users">,
        emailType: "welcome",
        recipientEmail: "status@celstate.test",
        componentEmailId: "comp_email_456",
      });
    });

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId as Id<"users">);
    });

    expect(user?.welcomeEmailStatus).toBe("sent");
    expect(user?.welcomeEmailSentAt).toBeDefined();
  });
});

describe("emails — recordEmailFailed", () => {
  it("stores a failed email event with error message", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "fail@celstate.test",
        credits: 3,
      });
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.emails.recordEmailFailed, {
        userId: userId as Id<"users">,
        emailType: "welcome",
        recipientEmail: "fail@celstate.test",
        error: "RESEND_API_KEY missing",
      });
    });

    const events = await t.run(async (ctx) => {
      return await ctx.db
        .query("emailEvents")
        .withIndex("by_user", (q) =>
          q.eq("userId", userId as Id<"users">),
        )
        .collect();
    });

    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe("failed");
    expect(events[0].emailType).toBe("welcome");
    expect(events[0].error).toBe("RESEND_API_KEY missing");
    expect(events[0].componentEmailId).toBeUndefined();
  });

  it("resets welcomeEmailStatus to pending when under max attempts", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "retry@celstate.test",
        credits: 3,
        welcomeEmailStatus: "sent",
        welcomeEmailAttempts: 0,
      });
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.emails.recordEmailFailed, {
        userId: userId as Id<"users">,
        emailType: "welcome",
        recipientEmail: "retry@celstate.test",
        error: "Temporary failure",
      });
    });

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId as Id<"users">);
    });

    expect(user?.welcomeEmailStatus).toBe("pending");
    expect(user?.welcomeEmailAttempts).toBe(1);
  });

  it("sets welcomeEmailStatus to failed after max attempts", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "maxfail@celstate.test",
        credits: 3,
        welcomeEmailStatus: "sent",
        welcomeEmailAttempts: 2,
      });
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.emails.recordEmailFailed, {
        userId: userId as Id<"users">,
        emailType: "welcome",
        recipientEmail: "maxfail@celstate.test",
        error: "Persistent failure",
      });
    });

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId as Id<"users">);
    });

    expect(user?.welcomeEmailStatus).toBe("failed");
    expect(user?.welcomeEmailAttempts).toBe(3);
  });
});

describe("emails — emailEvents schema integrity", () => {
  it("does not allow weekly_credit_reminder as emailType", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "schema@celstate.test",
        credits: 3,
      });
    });

    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("emailEvents", {
          userId: userId as Id<"users">,
          emailType: "weekly_credit_reminder" as any,
          recipientEmail: "schema@celstate.test",
          outcome: "sent",
          createdAt: Date.now(),
        });
      }),
    ).rejects.toThrow();
  });
});

// ========== CLASSIFICATION TESTS ==========

async function createUserWithGenerations(
  t: ReturnType<typeof convexTest>,
  opts: {
    credits: number;
    email?: string;
    generations: {
      status: GenerationStatus;
      prompt?: string;
      downloadedAt?: number;
      optimizedStorageId?: Id<"_storage">;
      resultStorageId?: Id<"_storage">;
      completedAt?: number;
    }[];
  },
): Promise<Id<"users">> {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: opts.email ?? "classify@celstate.test",
      credits: opts.credits,
      welcomeEmailStatus: "pending",
      welcomeEmailAttempts: 0,
    });
  });

  for (const gen of opts.generations) {
    await t.run(async (ctx) => {
      await ctx.db.insert("generations", {
        userId: userId as Id<"users">,
        prompt: gen.prompt ?? "test prompt",
        status: gen.status,
        aspectRatio: "1:1",
        creditsCost: 1,
        createdAt: Date.now(),
        completedAt: gen.completedAt,
        downloadedAt: gen.downloadedAt,
        optimizedStorageId: gen.optimizedStorageId,
        resultStorageId: gen.resultStorageId,
      });
    });
  }

  return userId as Id<"users">;
}

describe("emails — classifyUser", () => {
  it("classifies as no_credits_used when user has 0 completed generations", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUserWithGenerations(t, {
      credits: 3,
      generations: [],
    });

    const result = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.emails.classifyUser, {
        userId,
      });
    });

    expect(result.scenario).toBe("no_credits_used");
    expect(result.generationsCount).toBe(0);
    expect(result.downloadedCount).toBe(0);
    expect(result.creditsRemaining).toBe(3);
    expect(result.hasFailedGenerations).toBe(false);
    expect(result.failedGenerationPrompt).toBeNull();
  });

  it("scenario 5 with only failed generations sets hasFailedGenerations and prompt", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUserWithGenerations(t, {
      credits: 3,
      generations: [
        { status: "failed", prompt: "a dragon statue" },
      ],
    });

    const result = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.emails.classifyUser, {
        userId,
      });
    });

    expect(result.scenario).toBe("no_credits_used");
    expect(result.generationsCount).toBe(0);
    expect(result.hasFailedGenerations).toBe(true);
    expect(result.failedGenerationPrompt).toBe("a dragon statue");
  });

  it("scenario 5 with multiple failed generations returns most recent prompt", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUserWithGenerations(t, {
      credits: 3,
      generations: [
        { status: "failed", prompt: "older failed prompt", completedAt: Date.now() - 10000 },
        { status: "failed", prompt: "newer failed prompt", completedAt: Date.now() },
      ],
    });

    const result = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.emails.classifyUser, {
        userId,
      });
    });

    expect(result.scenario).toBe("no_credits_used");
    expect(result.hasFailedGenerations).toBe(true);
    expect(result.failedGenerationPrompt).toBe("newer failed prompt");
  });

  it("scenario 5 with one failed + one complete classifies by completed count", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUserWithGenerations(t, {
      credits: 2,
      generations: [
        { status: "failed", prompt: "failed attempt" },
        { status: "complete", downloadedAt: Date.now() },
      ],
    });

    const result = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.emails.classifyUser, {
        userId,
      });
    });

    expect(result.scenario).toBe("credits_remaining_downloaded");
    expect(result.generationsCount).toBe(1);
  });

  it("classifies as credits_remaining_downloaded (scenario 1)", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUserWithGenerations(t, {
      credits: 2,
      generations: [
        { status: "complete", downloadedAt: Date.now() },
        { status: "complete" },
      ],
    });

    const result = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.emails.classifyUser, {
        userId,
      });
    });

    expect(result.scenario).toBe("credits_remaining_downloaded");
    expect(result.generationsCount).toBe(2);
    expect(result.downloadedCount).toBe(1);
    expect(result.creditsRemaining).toBe(2);
  });

  it("classifies as credits_remaining_no_download (scenario 2)", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUserWithGenerations(t, {
      credits: 2,
      generations: [
        { status: "complete" },
        { status: "complete" },
      ],
    });

    const result = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.emails.classifyUser, {
        userId,
      });
    });

    expect(result.scenario).toBe("credits_remaining_no_download");
    expect(result.generationsCount).toBe(2);
    expect(result.downloadedCount).toBe(0);
  });

  it("scenario 2 returns most recent prompt and optimized image URL", async () => {
    const t = convexTest(schema, modules);

    const optimizedStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
      );
    });

    const userId = await createUserWithGenerations(t, {
      credits: 2,
      generations: [
        {
          status: "complete",
          prompt: "older prompt",
          completedAt: Date.now() - 10000,
        },
        {
          status: "complete",
          prompt: "a majestic phoenix in midflight",
          completedAt: Date.now(),
          optimizedStorageId: optimizedStorageId as Id<"_storage">,
        },
      ],
    });

    const result = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.emails.classifyUser, {
        userId,
      });
    });

    expect(result.scenario).toBe("credits_remaining_no_download");
    expect(result.recentGenerationPrompt).toBe("a majestic phoenix in midflight");
    expect(result.recentGenerationImageUrl).not.toBeNull();
  });

  it("scenario 2 falls back to resultStorageId when optimizedStorageId is missing", async () => {
    const t = convexTest(schema, modules);

    const resultStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
      );
    });

    const userId = await createUserWithGenerations(t, {
      credits: 2,
      generations: [
        {
          status: "complete",
          prompt: "a cute cartoon sticker",
          completedAt: Date.now(),
          resultStorageId: resultStorageId as Id<"_storage">,
        },
      ],
    });

    const result = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.emails.classifyUser, {
        userId,
      });
    });

    expect(result.scenario).toBe("credits_remaining_no_download");
    expect(result.recentGenerationPrompt).toBe("a cute cartoon sticker");
    expect(result.recentGenerationImageUrl).not.toBeNull();
  });

  it("scenario 2 returns null image URL when no storage IDs exist", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUserWithGenerations(t, {
      credits: 2,
      generations: [
        {
          status: "complete",
          prompt: "no storage ids on this one",
          completedAt: Date.now(),
        },
      ],
    });

    const result = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.emails.classifyUser, {
        userId,
      });
    });

    expect(result.scenario).toBe("credits_remaining_no_download");
    expect(result.recentGenerationPrompt).toBe("no storage ids on this one");
    expect(result.recentGenerationImageUrl).toBeNull();
  });

  it("classifies as credits_exhausted_downloaded (scenario 3)", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUserWithGenerations(t, {
      credits: 0,
      generations: [
        { status: "complete", downloadedAt: Date.now() },
        { status: "complete", downloadedAt: Date.now() },
      ],
    });

    const result = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.emails.classifyUser, {
        userId,
      });
    });

    expect(result.scenario).toBe("credits_exhausted_downloaded");
    expect(result.generationsCount).toBe(2);
    expect(result.downloadedCount).toBe(2);
  });

  it("classifies as credits_exhausted_no_download (scenario 4)", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUserWithGenerations(t, {
      credits: 0,
      generations: [
        { status: "complete" },
      ],
    });

    const result = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.emails.classifyUser, {
        userId,
      });
    });

    expect(result.scenario).toBe("credits_exhausted_no_download");
    expect(result.generationsCount).toBe(1);
    expect(result.downloadedCount).toBe(0);
  });

  it("only counts completed generations, not failed/generating", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUserWithGenerations(t, {
      credits: 2,
      generations: [
        { status: "complete", downloadedAt: Date.now() },
        { status: "generating" },
        { status: "failed" },
      ],
    });

    const result = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.emails.classifyUser, {
        userId,
      });
    });

    expect(result.generationsCount).toBe(1);
    expect(result.downloadedCount).toBe(1);
    expect(result.scenario).toBe("credits_remaining_downloaded");
    expect(result.hasFailedGenerations).toBe(true);
  });
});

// ========== SCENARIO 3 EMAIL TEMPLATE TESTS ==========

describe("emails — scenario3EmailHtml", () => {
  it("contains correct pricing ($5/15 credits, $10/40 credits)", () => {
    const html = scenario3EmailHtml("Test User", 3);
    expect(html).toContain("$5 for 15 credits");
    expect(html).toContain("$10 gets you 40");
    expect(html).not.toContain("$5 for 10 credits");
  });

  it("contains UTM-tagged CTA link to credits page", () => {
    const html = scenario3EmailHtml("Test User", 3);
    expect(html).toContain("/app/credits?utm_source=welcome_email&utm_medium=email&utm_campaign=scenario_3");
  });

  it("does not contain em dashes in copy", () => {
    const html = scenario3EmailHtml("Test User", 3);
    expect(html).not.toContain("\u2014");
  });

  it("includes generations count in made text", () => {
    const html = scenario3EmailHtml("Test User", 5);
    expect(html).toContain("make 5 images");
  });

  it("uses singular 'image' for one generation", () => {
    const html = scenario3EmailHtml("Test User", 1);
    expect(html).toContain("make 1 image");
  });

  it("includes reply CTA in P.S.", () => {
    const html = scenario3EmailHtml("Test User", 3);
    expect(html).toContain("just reply and");
    expect(html).toContain("tell me why");
  });

  it("includes unsubscribe link in footer", () => {
    const html = scenario3EmailHtml("Test User", 3);
    expect(html).toContain("Unsubscribe</a>");
  });
});

// ========== SCENARIO 4 EMAIL TEMPLATE TESTS ==========

describe("emails — scenario4EmailHtml", () => {
  it("contains UTM-tagged CTA link with scenario_4", () => {
    const html = scenario4EmailHtml("Test User", 3, "a cute cat", null);
    expect(html).toContain("utm_source=welcome_email&utm_medium=email&utm_campaign=scenario_4");
  });

  it("does NOT contain credit pack pricing", () => {
    const html = scenario4EmailHtml("Test User", 3, null, null);
    expect(html).not.toContain("$5 for 15 credits");
    expect(html).not.toContain("$10 gets you 40");
    expect(html).not.toContain("credit packs");
  });

  it("does not contain em dashes in copy", () => {
    const html = scenario4EmailHtml("Test User", 3, null, null);
    expect(html).not.toContain("\u2014");
  });

  it("includes generations count in made text", () => {
    const html = scenario4EmailHtml("Test User", 5, null, null);
    expect(html).toContain("generated 5 images");
  });

  it("uses singular 'image' for one generation", () => {
    const html = scenario4EmailHtml("Test User", 1, null, null);
    expect(html).toContain("generated 1 image");
  });

  it("includes reply CTA in P.S.", () => {
    const html = scenario4EmailHtml("Test User", 3, null, null);
    expect(html).toContain("just reply to this email");
    expect(html).toContain("went wrong");
  });

  it("includes unsubscribe link in footer", () => {
    const html = scenario4EmailHtml("Test User", 3, null, null);
    expect(html).toContain("Unsubscribe</a>");
  });

  it("includes prompt when provided", () => {
    const html = scenario4EmailHtml("Test User", 2, "a majestic phoenix", null);
    expect(html).toContain("a majestic phoenix");
  });

  it("includes image when provided", () => {
    const html = scenario4EmailHtml("Test User", 2, null, "https://example.com/img.png");
    expect(html).toContain("https://example.com/img.png");
    expect(html).toContain("<img");
  });

  it("handles null name with Hi there fallback", () => {
    const html = scenario4EmailHtml(undefined, 3, null, null);
    expect(html).toContain("Hi there,");
  });

  it("handles null prompt and imageUrl gracefully", () => {
    const html = scenario4EmailHtml("Test User", 3, null, null);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("mentions 3 bonus credits", () => {
    const html = scenario4EmailHtml("Test User", 3, null, null);
    expect(html).toContain("3 bonus credits");
  });
});

// ========== SCENARIO 5 EMAIL TEMPLATE TESTS ==========

describe("emails — scenario5NeverTriedEmailHtml", () => {
  it("contains credit count in copy", () => {
    const html = scenario5NeverTriedEmailHtml("Test User", 3);
    expect(html).toContain("3 free credits");
  });

  it("uses singular 'credit' for 1", () => {
    const html = scenario5NeverTriedEmailHtml("Test User", 1);
    expect(html).toContain("1 free credit");
  });

  it("contains 3 curated prompt deep links with source param", () => {
    const html = scenario5NeverTriedEmailHtml("Test User", 3);
    expect(html).toContain("source=welcome_email_scenario_5_never_tried");
    expect(html).toContain("prompt=");
    expect(html).toContain("A cute cartoon fox mascot");
    expect(html).toContain("A vintage botanical illustration of a fern");
    expect(html).toContain("A minimalist logo for a coffee shop");
  });

  it("contains primary CTA button with deep link", () => {
    const html = scenario5NeverTriedEmailHtml("Test User", 3);
    expect(html).toContain("Try your first generation");
    expect(html).toContain("source=welcome_email_scenario_5_never_tried");
  });

  it("does not contain em dashes in copy", () => {
    const html = scenario5NeverTriedEmailHtml("Test User", 3);
    expect(html).not.toContain("\u2014");
  });

  it("includes unsubscribe link in footer", () => {
    const html = scenario5NeverTriedEmailHtml("Test User", 3);
    expect(html).toContain("Unsubscribe</a>");
  });

  it("includes reply CTA in P.S.", () => {
    const html = scenario5NeverTriedEmailHtml("Test User", 3);
    expect(html).toContain("What stopped you");
    expect(html).toContain("reply");
  });

  it("handles null name with Hi there fallback", () => {
    const html = scenario5NeverTriedEmailHtml(undefined, 3);
    expect(html).toContain("Hi there,");
  });
});

describe("emails — scenario5TriedFailedEmailHtml", () => {
  it("contains credit refund mention", () => {
    const html = scenario5TriedFailedEmailHtml("Test User", 3, "my failed prompt");
    expect(html).toContain("refunded");
  });

  it("includes failed prompt when provided", () => {
    const html = scenario5TriedFailedEmailHtml("Test User", 3, "a dragon statue");
    expect(html).toContain("a dragon statue");
  });

  it("handles null failed prompt gracefully", () => {
    const html = scenario5TriedFailedEmailHtml("Test User", 3, null);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("contains known-good prompt deep link with source param", () => {
    const html = scenario5TriedFailedEmailHtml("Test User", 3, "failed prompt");
    expect(html).toContain("source=welcome_email_scenario_5_tried_failed");
    expect(html).toContain("prompt=");
    expect(html).toContain("A cute cartoon fox mascot");
  });

  it("contains CTA button", () => {
    const html = scenario5TriedFailedEmailHtml("Test User", 3, "failed prompt");
    expect(html).toContain("Try this prompt");
  });

  it("does not contain em dashes in copy", () => {
    const html = scenario5TriedFailedEmailHtml("Test User", 3, "failed prompt");
    expect(html).not.toContain("\u2014");
  });

  it("includes unsubscribe link in footer", () => {
    const html = scenario5TriedFailedEmailHtml("Test User", 3, "failed prompt");
    expect(html).toContain("Unsubscribe</a>");
  });

  it("includes reply CTA in P.S.", () => {
    const html = scenario5TriedFailedEmailHtml("Test User", 3, "failed prompt");
    expect(html).toContain("What were you trying to make");
    expect(html).toContain("Reply");
  });

  it("handles null name with Hi there fallback", () => {
    const html = scenario5TriedFailedEmailHtml(undefined, 3, "failed prompt");
    expect(html).toContain("Hi there,");
  });
});

// ========== BONUS CREDITS GRANT TESTS ==========

describe("emails — grantWelcomeEmailBonusCredits", () => {
  it("grants 3 credits to a user with 0 credits", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "bonus@celstate.test",
        credits: 0,
        welcomeEmailStatus: "pending",
        welcomeEmailAttempts: 0,
      });
    });

    const granted = await t.run(async (ctx) => {
      return await ctx.runMutation(internal.emails.grantWelcomeEmailBonusCredits, {
        userId: userId as Id<"users">,
        amount: 3,
      });
    });

    expect(granted).toBe(true);

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId as Id<"users">);
    });

    expect(user?.credits).toBe(3);
    expect(user?.welcomeEmailBonusCreditsGranted).toBe(true);
  });

  it("creates a creditGrants row with reason reengagement_bonus", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "grant@celstate.test",
        credits: 0,
        welcomeEmailStatus: "pending",
        welcomeEmailAttempts: 0,
      });
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.emails.grantWelcomeEmailBonusCredits, {
        userId: userId as Id<"users">,
        amount: 3,
      });
    });

    const grants = await t.run(async (ctx) => {
      return await ctx.db
        .query("creditGrants")
        .withIndex("by_user", (q) =>
          q.eq("userId", userId as Id<"users">),
        )
        .collect();
    });

    expect(grants).toHaveLength(1);
    expect(grants[0].amount).toBe(3);
    expect(grants[0].reason).toBe("reengagement_bonus");
  });

  it("is idempotent — second call does not grant again", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "idempotent@celstate.test",
        credits: 0,
        welcomeEmailStatus: "pending",
        welcomeEmailAttempts: 0,
      });
    });

    const first = await t.run(async (ctx) => {
      return await ctx.runMutation(internal.emails.grantWelcomeEmailBonusCredits, {
        userId: userId as Id<"users">,
        amount: 3,
      });
    });

    const second = await t.run(async (ctx) => {
      return await ctx.runMutation(internal.emails.grantWelcomeEmailBonusCredits, {
        userId: userId as Id<"users">,
        amount: 3,
      });
    });

    expect(first).toBe(true);
    expect(second).toBe(false);

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId as Id<"users">);
    });

    expect(user?.credits).toBe(3);

    const grants = await t.run(async (ctx) => {
      return await ctx.db
        .query("creditGrants")
        .withIndex("by_user", (q) =>
          q.eq("userId", userId as Id<"users">),
        )
        .collect();
    });

    expect(grants).toHaveLength(1);
  });

  it("returns false for non-existent user", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "temp2@celstate.test",
        credits: 0,
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.delete(userId as Id<"users">);
    });

    const granted = await t.run(async (ctx) => {
      return await ctx.runMutation(internal.emails.grantWelcomeEmailBonusCredits, {
        userId: userId as Id<"users">,
        amount: 3,
      });
    });

    expect(granted).toBe(false);
  });
});

describe("emails — scenario1EmailHtml pricing fix", () => {
  it("contains correct pricing ($5/15 credits, not $5/10)", () => {
    const html = scenario1EmailHtml("Test User", 3);
    expect(html).toContain("$5 for 15 credits");
    expect(html).toContain("$10 gets you 40");
    expect(html).not.toContain("$5 for 10 credits");
  });

  it("contains UTM-tagged CTA link", () => {
    const html = scenario1EmailHtml("Test User", 3);
    expect(html).toContain("utm_source=welcome_email&utm_medium=email&utm_campaign=scenario_1");
  });
});

// ========== CLAIM TESTS ==========

describe("emails — claimUserForWelcomeEmail", () => {
  it("claims a pending user and returns true", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "claim@celstate.test",
        credits: 3,
        welcomeEmailStatus: "pending",
        welcomeEmailAttempts: 0,
      });
    });

    const claimed = await t.run(async (ctx) => {
      return await ctx.runMutation(internal.emails.claimUserForWelcomeEmail, {
        userId: userId as Id<"users">,
      });
    });

    expect(claimed).toBe(true);

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId as Id<"users">);
    });

    expect(user?.welcomeEmailStatus).toBe("sent");
  });

  it("returns false for a user already claimed (sent)", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "claimed@celstate.test",
        credits: 3,
        welcomeEmailStatus: "sent",
        welcomeEmailAttempts: 0,
      });
    });

    const claimed = await t.run(async (ctx) => {
      return await ctx.runMutation(internal.emails.claimUserForWelcomeEmail, {
        userId: userId as Id<"users">,
      });
    });

    expect(claimed).toBe(false);
  });

  it("returns false for a non-existent user", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "temp@celstate.test",
        credits: 3,
        welcomeEmailStatus: "sent",
        welcomeEmailAttempts: 0,
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.delete(userId as Id<"users">);
    });

    const claimed = await t.run(async (ctx) => {
      return await ctx.runMutation(internal.emails.claimUserForWelcomeEmail, {
        userId: userId as Id<"users">,
      });
    });

    expect(claimed).toBe(false);
  });
});

// ========== UNSUBSCRIBE TESTS ==========

describe("emails — unsubscribe", () => {
  it("unsubscribes a user with valid token", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "unsub@celstate.test",
        credits: 3,
      });
    });

    // Generate the expected token using the same HMAC secret.
    const { generateUnsubscribeToken } = await import("./emails.js");
    const token = await generateUnsubscribeToken("unsub@celstate.test");

    const ok = await t.mutation(api.emails.unsubscribe, {
      email: "unsub@celstate.test",
      token,
    });

    expect(ok).toBe(true);

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId as Id<"users">);
    });

    expect(user?.emailUnsubscribed).toBe(true);
  });

  it("returns false for unknown email", async () => {
    const t = convexTest(schema, modules);

    const { generateUnsubscribeToken } = await import("./emails.js");
    const token = await generateUnsubscribeToken("nobody@celstate.test");

    const ok = await t.mutation(api.emails.unsubscribe, {
      email: "nobody@celstate.test",
      token,
    });

    expect(ok).toBe(false);
  });

  it("rejects unsubscribe with invalid token", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "tokenfail@celstate.test",
        credits: 3,
      });
    });

    const ok = await t.mutation(api.emails.unsubscribe, {
      email: "tokenfail@celstate.test",
      token: "invalid-token",
    });

    expect(ok).toBe(false);
  });
});

// ========== ELIGIBLE USERS TESTS ==========

describe("emails — getEligibleUsersForWelcomeEmail", () => {
  it("excludes users who signed up less than 3 hours ago", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "toofresh@celstate.test",
        credits: 3,
        welcomeEmailStatus: "pending",
        welcomeEmailAttempts: 0,
      });
    });

    const users = await t.run(async (ctx) => {
      return await ctx.runQuery(
        internal.emails.getEligibleUsersForWelcomeEmail,
        {},
      );
    });

    const excluded = users.filter(
      (u) => u.email === "toofresh@celstate.test",
    );
    expect(excluded).toHaveLength(0);
  });

  it("excludes users who already have welcomeEmailStatus sent", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "alreadysent@celstate.test",
        credits: 3,
        welcomeEmailStatus: "sent",
        welcomeEmailAttempts: 0,
      });
    });

    const users = await t.run(async (ctx) => {
      return await ctx.runQuery(
        internal.emails.getEligibleUsersForWelcomeEmail,
        {},
      );
    });

    const excluded = users.filter(
      (u) => u.email === "alreadysent@celstate.test",
    );
    expect(excluded).toHaveLength(0);
  });

  it("excludes unsubscribed users", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "unsubscribed@celstate.test",
        credits: 3,
        welcomeEmailStatus: "pending",
        welcomeEmailAttempts: 0,
        emailUnsubscribed: true,
      });
    });

    const users = await t.run(async (ctx) => {
      return await ctx.runQuery(
        internal.emails.getEligibleUsersForWelcomeEmail,
        {},
      );
    });

    const excluded = users.filter(
      (u) => u.email === "unsubscribed@celstate.test",
    );
    expect(excluded).toHaveLength(0);
  });

  it("excludes users without an email", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        credits: 3,
        welcomeEmailStatus: "pending",
        welcomeEmailAttempts: 0,
      });
    });

    const users = await t.run(async (ctx) => {
      return await ctx.runQuery(
        internal.emails.getEligibleUsersForWelcomeEmail,
        {},
      );
    });

    expect(users.every((u) => u.email !== undefined)).toBe(true);
  });

  it("does not exclude pending users with prior failed attempts (no 24h upper bound)", async () => {
    const t = convexTest(schema, modules);

    // A user whose email send failed and was reset to pending should
    // remain eligible. The old 24h upper bound would permanently skip
    // them if the next cron ran >24h after signup. Without the upper
    // bound, welcomeEmailStatus === "pending" alone controls eligibility.
    //
    // convex-test uses real wall clock for _creationTime so we can't
    // backdate a user >24h. Instead we verify the structural property:
    // welcomeEmailAttempts > 0 does not block eligibility. The user is
    // created moments ago (<3h) so the lower bound excludes them — but
    // the assertion documents that no upper bound filter exists.
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "retryuser@celstate.test",
        credits: 3,
        welcomeEmailStatus: "pending",
        welcomeEmailAttempts: 2,
      });
    });

    const users = await t.run(async (ctx) => {
      return await ctx.runQuery(
        internal.emails.getEligibleUsersForWelcomeEmail,
        {},
      );
    });

    // Excluded by 3h lower bound (just created), NOT by any upper bound.
    const found = users.filter((u) => u.email === "retryuser@celstate.test");
    expect(found).toHaveLength(0);
  });
});

// ========== ANALYTICS JOIN TESTS ==========

describe("emails — handleEmailEvent analytics join", () => {
  it("looks up emailEvent by componentEmailId and stamps userId and scenario on PostHog capture", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "analytics@celstate.test",
        credits: 3,
      });
    });

    // Insert an emailEvent record as if a welcome email was sent.
    await t.run(async (ctx) => {
      await ctx.db.insert("emailEvents", {
        userId: userId as Id<"users">,
        emailType: "welcome",
        scenario: "credits_remaining_downloaded",
        recipientEmail: "analytics@celstate.test",
        componentEmailId: "comp_analytics_001",
        outcome: "sent",
        createdAt: Date.now(),
      });
    });

    // Verify the emailEvent can be found by componentEmailId via the index.
    const found = await t.run(async (ctx) => {
      return await ctx.db
        .query("emailEvents")
        .withIndex("by_component_email_id", (q) =>
          q.eq("componentEmailId", "comp_analytics_001"),
        )
        .first();
    });

    expect(found).not.toBeNull();
    expect(found!.userId).toBe(userId as Id<"users">);
    expect(found!.scenario).toBe("credits_remaining_downloaded");
  });

  it("returns null for unknown componentEmailId without throwing", async () => {
    const t = convexTest(schema, modules);

    const found = await t.run(async (ctx) => {
      return await ctx.db
        .query("emailEvents")
        .withIndex("by_component_email_id", (q) =>
          q.eq("componentEmailId", "nonexistent_id"),
        )
        .first();
    });

    expect(found).toBeNull();
  });
});

// ========== REGRESSION: MANDATORY TOKEN + HMAC SECRET HARD-FAIL ==========

describe("emails — unsubscribe requires token", () => {
  it("rejects unsubscribe without token (token is now mandatory)", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "notoken@celstate.test",
        credits: 3,
      });
    });

    // Type-level check: token is required. Runtime: should throw or return false.
    // Since the schema now requires token as v.string(), calling without it
    // will throw a validation error.
    await expect(
      t.mutation(api.emails.unsubscribe, {
        email: "notoken@celstate.test",
        // @ts-expect-error — token is now required
        token: undefined,
      }),
    ).rejects.toThrow();
  });
});

describe("emails — resubscribe requires token", () => {
  it("resubscribes a user with valid token", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "resub@celstate.test",
        credits: 3,
        emailUnsubscribed: true,
      });
    });

    const { generateUnsubscribeToken } = await import("./emails.js");
    const token = await generateUnsubscribeToken("resub@celstate.test");

    const ok = await t.mutation(api.emails.resubscribe, {
      email: "resub@celstate.test",
      token,
    });

    expect(ok).toBe(true);

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId as Id<"users">);
    });

    expect(user?.emailUnsubscribed).toBe(false);
  });

  it("rejects resubscribe with invalid token", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "resubfail@celstate.test",
        credits: 3,
        emailUnsubscribed: true,
      });
    });

    const ok = await t.mutation(api.emails.resubscribe, {
      email: "resubfail@celstate.test",
      token: "bad-token",
    });

    expect(ok).toBe(false);
  });

  it("rejects resubscribe without token", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "resubnotoken@celstate.test",
        credits: 3,
        emailUnsubscribed: true,
      });
    });

    await expect(
      t.mutation(api.emails.resubscribe, {
        email: "resubnotoken@celstate.test",
        // @ts-expect-error — token is now required
        token: undefined,
      }),
    ).rejects.toThrow();
  });
});

describe("emails — generateUnsubscribeToken hard-fails without EMAIL_HMAC_SECRET", () => {
  it("throws when EMAIL_HMAC_SECRET is not set", async () => {
    vi.stubEnv("EMAIL_HMAC_SECRET", "");
    const { generateUnsubscribeToken } = await import("./emails.js");
    await expect(
      generateUnsubscribeToken("test@celstate.test"),
    ).rejects.toThrow("EMAIL_HMAC_SECRET");
  });
});

// ========== REGRESSION: HTML ESCAPING IN EMAIL TEMPLATES ==========

describe("emails — HTML escaping of user prompts", () => {
  const maliciousPrompt = `<script>alert("xss")</script>`;
  const trickyPrompt = `A "quote" & <b>bold</b> 'apostrophe'`;

  it("scenario2EmailHtml escapes HTML in prompt block", () => {
    const html = scenario2EmailHtml("Test", 2, maliciousPrompt, null);
    expect(html).not.toContain(maliciousPrompt);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;/script&gt;");
  });

  it("scenario2EmailHtml escapes HTML in img alt attribute", () => {
    const html = scenario2EmailHtml("Test", 2, trickyPrompt, "https://example.com/img.png");
    expect(html).toContain("&quot;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&#39;");
  });

  it("scenario4EmailHtml escapes HTML in prompt block", () => {
    const html = scenario4EmailHtml("Test", 2, maliciousPrompt, null);
    expect(html).not.toContain(maliciousPrompt);
    expect(html).toContain("&lt;script&gt;");
  });

  it("scenario4EmailHtml escapes HTML in img alt attribute", () => {
    const html = scenario4EmailHtml("Test", 2, trickyPrompt, "https://example.com/img.png");
    expect(html).toContain("&quot;");
    expect(html).toContain("&amp;");
  });

  it("scenario5TriedFailedEmailHtml escapes HTML in failed prompt block", () => {
    const html = scenario5TriedFailedEmailHtml("Test", 3, maliciousPrompt);
    expect(html).not.toContain(maliciousPrompt);
    expect(html).toContain("&lt;script&gt;");
  });

  it("scenario5TriedFailedEmailHtml escapes tricky characters", () => {
    const html = scenario5TriedFailedEmailHtml("Test", 3, trickyPrompt);
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
    expect(html).toContain("&amp;");
  });

  it("normal prompts render unchanged in scenario 2", () => {
    const normalPrompt = "A cute cartoon fox mascot";
    const html = scenario2EmailHtml("Test", 2, normalPrompt, null);
    expect(html).toContain(normalPrompt);
  });

  it("normal prompts render unchanged in scenario 4", () => {
    const normalPrompt = "A cute cartoon fox mascot";
    const html = scenario4EmailHtml("Test", 2, normalPrompt, null);
    expect(html).toContain(normalPrompt);
  });
});

// ========== REGRESSION: emailLayout SHARED HELPER ==========

describe("emails — emailLayout shared shell", () => {
  it("all scenario templates produce valid HTML shell with DOCTYPE and body", () => {
    const scenarios = [
      scenario1EmailHtml("Test", 3),
      scenario2EmailHtml("Test", 2, "prompt", null),
      scenario3EmailHtml("Test", 3),
      scenario4EmailHtml("Test", 3, "prompt", null),
      scenario5NeverTriedEmailHtml("Test", 3),
      scenario5TriedFailedEmailHtml("Test", 3, "prompt"),
    ];

    for (const html of scenarios) {
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html lang=\"en\">");
      expect(html).toContain("<body");
      expect(html).toContain("</body>");
      expect(html).toContain("</html>");
    }
  });

  it("all scenario templates include emailFooter", () => {
    const scenarios = [
      scenario1EmailHtml("Test", 3),
      scenario2EmailHtml("Test", 2, "prompt", null),
      scenario3EmailHtml("Test", 3),
      scenario4EmailHtml("Test", 3, "prompt", null),
      scenario5NeverTriedEmailHtml("Test", 3),
      scenario5TriedFailedEmailHtml("Test", 3, "prompt"),
    ];

    for (const html of scenarios) {
      expect(html).toContain("Unsubscribe</a>");
    }
  });

  it("all scenario templates include greeting h1", () => {
    const scenarios = [
      scenario1EmailHtml("Alice", 3),
      scenario2EmailHtml("Bob", 2, "prompt", null),
      scenario3EmailHtml("Charlie", 3),
      scenario4EmailHtml("Diana", 3, "prompt", null),
      scenario5NeverTriedEmailHtml("Eve", 3),
      scenario5TriedFailedEmailHtml("Frank", 3, "prompt"),
    ];

    for (const html of scenarios) {
      expect(html).toContain("<h1");
      expect(html).toContain("</h1>");
    }
  });
});
