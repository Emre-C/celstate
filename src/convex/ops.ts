import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalAction, internalMutation, internalQuery } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { generationStageValidator } from "./lib/validators.js";
import {
  assertOkWebhookResponse,
  buildGenerationAlertRequest,
  buildSecretRotationReminderRequest,
  buildSignupAlertRequest,
  readOpsAlertRuntimeConfig,
  summarizeGenerationOpsEvents,
} from "./lib/ops.js";
import { insertGenerationOpsEventRow } from "./lib/generationOpsEvents.js";

function clampHoursWindow(hoursWindow: number | undefined): number {
  if (hoursWindow === undefined || !Number.isFinite(hoursWindow)) {
    return 24;
  }

  return Math.min(Math.max(Math.floor(hoursWindow), 1), 24 * 30);
}

function toRecentEvent(event: Doc<"generationOpsEvents">) {
  return {
    attemptDurationMs: event.attemptDurationMs,
    createdAt: event.createdAt,
    error: event.error,
    eventType: event.eventType,
    generationDurationMs: event.generationDurationMs,
    generationId: event.generationId,
    retryCount: event.retryCount,
    severity: event.severity,
    stage: event.stage,
    statusMessage: event.statusMessage,
    totalRetryCount: event.totalRetryCount,
    userEmail: event.userEmail,
    userId: event.userId,
  };
}

export const recordAlertEvent = internalMutation({
  args: {
    generationId: v.id("generations"),
    userId: v.id("users"),
    userEmail: v.optional(v.string()),
    eventType: v.union(v.literal("alert_sent"), v.literal("alert_failed")),
    severity: v.union(v.literal("warning"), v.literal("critical")),
    stage: v.optional(generationStageValidator),
    retryCount: v.optional(v.number()),
    totalRetryCount: v.optional(v.number()),
    statusMessage: v.optional(v.string()),
    error: v.optional(v.string()),
    generationDurationMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await insertGenerationOpsEventRow(ctx, args);
    return null;
  },
});

export const sendGenerationAlert = internalAction({
  args: {
    alertType: v.union(v.literal("generation_failed"), v.literal("generation_stalled")),
    generationId: v.id("generations"),
    severity: v.union(v.literal("warning"), v.literal("critical")),
    stage: v.optional(generationStageValidator),
    retryCount: v.optional(v.number()),
    totalRetryCount: v.optional(v.number()),
    statusMessage: v.optional(v.string()),
    error: v.optional(v.string()),
    generationDurationMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.runQuery(internal.generations.getById, {
      generationId: args.generationId,
    });

    if (!generation) {
      return null;
    }

    const user = await ctx.runQuery(internal.users.getById, {
      userId: generation.userId,
    });
    const config = readOpsAlertRuntimeConfig();
    const userEmail = user?.email ?? undefined;
    const alertBase = {
      generationDurationMs: args.generationDurationMs,
      generationId: args.generationId,
      retryCount: args.retryCount,
      severity: args.severity,
      stage: args.stage,
      statusMessage: args.statusMessage,
      totalRetryCount: args.totalRetryCount,
      userEmail,
      userId: generation.userId,
    };

    if (!config.webhookUrl) {
      await ctx.runMutation(internal.ops.recordAlertEvent, {
        ...alertBase,
        error: "OPS_ALERT_WEBHOOK_URL is not configured",
        eventType: "alert_failed",
      });
      return null;
    }

    try {
      const request = buildGenerationAlertRequest(config, {
        alertType: args.alertType,
        createdAt: generation.createdAt,
        error: args.error,
        generationDurationMs: args.generationDurationMs,
        generationId: String(args.generationId),
        retryCount: args.retryCount,
        severity: args.severity,
        stage: args.stage,
        statusMessage: args.statusMessage,
        totalRetryCount: args.totalRetryCount,
        userEmail,
        userId: String(generation.userId),
      });

      const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
      });

      assertOkWebhookResponse(response);

      await ctx.runMutation(internal.ops.recordAlertEvent, {
        ...alertBase,
        eventType: "alert_sent",
      });
    } catch (error) {
      await ctx.runMutation(internal.ops.recordAlertEvent, {
        ...alertBase,
        error: error instanceof Error ? error.message : String(error),
        eventType: "alert_failed",
      });
    }

    return null;
  },
});

export const sendSecretRotationReminder = internalAction({
  args: {
    cadenceLabel: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const opsConfig = readOpsAlertRuntimeConfig();
    if (!opsConfig.webhookUrl) {
      console.warn("Skipping secret rotation reminder: OPS_ALERT_WEBHOOK_URL not configured");
      return null;
    }

    const cadenceLabel = args.cadenceLabel ?? "quarterly";
    const gcpProjectId = process.env.VERTEX_AI_PROJECT_ID?.trim() || undefined;
    const gcpServiceAccountEmail = readGcpServiceAccountEmail();

    try {
      const request = buildSecretRotationReminderRequest(opsConfig, {
        cadenceLabel,
        gcpProjectId,
        gcpServiceAccountEmail,
      });

      const response = await fetch(request.url, {
        body: request.body,
        headers: request.headers,
        method: "POST",
      });

      assertOkWebhookResponse(response);
    } catch (error) {
      console.error("Failed to post secret rotation reminder", error);
    }

    return null;
  },
});

function readGcpServiceAccountEmail(): string | undefined {
  const explicit = process.env.VERTEX_AI_CLIENT_EMAIL?.trim();
  if (explicit) {
    return explicit;
  }

  const json = process.env.VERTEX_AI_SERVICE_ACCOUNT_JSON?.trim();
  if (!json) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(json);
    if (
      parsed &&
      typeof parsed === "object" &&
      "client_email" in parsed &&
      typeof (parsed as { client_email: unknown }).client_email === "string"
    ) {
      return (parsed as { client_email: string }).client_email;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export const sendSignupAlert = internalAction({
  args: {
    authProvider: v.union(v.literal("google"), v.literal("apple"), v.literal("unknown")),
    initialCredits: v.number(),
    name: v.optional(v.string()),
    userEmail: v.optional(v.string()),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const opsConfig = readOpsAlertRuntimeConfig();
    if (!opsConfig.webhookUrl) {
      return null;
    }

    try {
      const request = buildSignupAlertRequest(opsConfig, {
        authProvider: args.authProvider,
        initialCredits: args.initialCredits,
        name: args.name,
        userEmail: args.userEmail,
        userId: args.userId,
      });

      const response = await fetch(request.url, {
        body: request.body,
        headers: request.headers,
        method: "POST",
      });

      assertOkWebhookResponse(response);
    } catch (error) {
      console.error("Failed to send signup Discord notification", error);
    }

    return null;
  },
});

const recentOpsEventValidator = v.object({
  attemptDurationMs: v.optional(v.number()),
  createdAt: v.number(),
  error: v.optional(v.string()),
  eventType: v.union(
    v.literal("generation_requested"),
    v.literal("stage_succeeded"),
    v.literal("stage_retry_scheduled"),
    v.literal("generation_completed"),
    v.literal("generation_failed"),
    v.literal("generation_stalled"),
    v.literal("alert_sent"),
    v.literal("alert_failed"),
  ),
  generationDurationMs: v.optional(v.number()),
  generationId: v.id("generations"),
  retryCount: v.optional(v.number()),
  severity: v.optional(v.union(
    v.literal("info"),
    v.literal("warning"),
    v.literal("critical"),
  )),
  stage: v.optional(generationStageValidator),
  statusMessage: v.optional(v.string()),
  totalRetryCount: v.optional(v.number()),
  userEmail: v.optional(v.string()),
  userId: v.id("users"),
});

export const getGenerationOpsSummary = internalQuery({
  args: {
    hoursWindow: v.optional(v.number()),
    // Caller must supply the observation timestamp so this query is
    // deterministic and Convex can cache the result correctly.
    now: v.number(),
  },
  returns: v.object({
    recentCriticalEvents: v.array(recentOpsEventValidator),
    summary: v.object({
      totals: v.object({
        requested: v.number(),
        completed: v.number(),
        failed: v.number(),
        stalled: v.number(),
        retries: v.number(),
        alertFailures: v.number(),
        successRate: v.union(v.number(), v.null()),
        failureRate: v.union(v.number(), v.null()),
      }),
      performance: v.object({
        avgGenerationTimeMs: v.union(v.number(), v.null()),
        p50GenerationTimeMs: v.union(v.number(), v.null()),
        p95GenerationTimeMs: v.union(v.number(), v.null()),
        avgAttemptTimeMs: v.union(v.number(), v.null()),
        p95AttemptTimeMs: v.union(v.number(), v.null()),
        avgRetriesPerCompletedGeneration: v.union(v.number(), v.null()),
      }),
    }),
    window: v.object({
      hoursWindow: v.number(),
      now: v.number(),
      since: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const hoursWindow = clampHoursWindow(args.hoursWindow);
    const now = args.now;
    const since = now - hoursWindow * 60 * 60 * 1000;
    const events = await ctx.db
      .query("generationOpsEvents")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", since))
      .collect();

    const summary = summarizeGenerationOpsEvents(
      events.map((event) => ({
        attemptDurationMs: event.attemptDurationMs,
        eventType: event.eventType,
        generationDurationMs: event.generationDurationMs,
        totalRetryCount: event.totalRetryCount,
      })),
    );

    const recentCriticalEvents = events
      .filter((event) => event.severity === "warning" || event.severity === "critical")
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 20)
      .map(toRecentEvent);

    return {
      recentCriticalEvents,
      summary,
      window: {
        hoursWindow,
        now,
        since,
      },
    };
  },
});

