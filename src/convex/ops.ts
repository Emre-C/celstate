import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import {
  generationOpsEventTypeValidator,
  generationStageValidator,
} from "./lib/validation/validators.js";
import {
  buildGenerationInvestigationVerdict,
  type CriticalPathVerdict,
  type OpsTimelineEvent,
} from "../lib/ops/investigation.js";
import {
  buildGenerationAlertRequest,
  buildSecretRotationReminderRequest,
  buildSignupAlertRequest,
  readOpsAlertRuntimeConfig,
  sendOpsWebhook,
  summarizeGenerationOpsEvents,
} from "./lib/ops.js";
import { insertGenerationOpsEventRow } from "./lib/generation/generationOpsEvents.js";
import {
  criticalPathHealthReportValidator,
  generationInvestigationReadModelValidator,
  recentGenerationIncidentsReportValidator,
  recentSignupsReportValidator,
  userInvestigationReportValidator,
} from "./lib/opsInvestigation.js";

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

export const recordOpsAlertEvent = internalMutation({
  args: {
    alertType: v.union(
      v.literal("signup_alert"),
      v.literal("purchase_alert"),
      v.literal("secret_rotation_reminder"),
      v.literal("email_delivery_alert"),
    ),
    outcome: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("opsAlertEvents", {
      alertType: args.alertType,
      outcome: args.outcome,
      error: args.error,
      createdAt: Date.now(),
    });
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
        creditRefunded: generation.creditRefundedAt !== undefined,
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

      await sendOpsWebhook(request);

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
  handler: async (ctx, args) => {
    const opsConfig = readOpsAlertRuntimeConfig();
    if (!opsConfig.webhookUrl) {
      console.warn("Skipping secret rotation reminder: OPS_ALERT_WEBHOOK_URL not configured");
      return null;
    }

    const cadenceLabel = args.cadenceLabel ?? "quarterly";
    const gcpProjectId = process.env.VERTEX_AI_PROJECT_ID?.trim() || undefined;
    const gcpServiceAccountEmail = readGcpServiceAccountEmail();

    const request = buildSecretRotationReminderRequest(opsConfig, {
      cadenceLabel,
      gcpProjectId,
      gcpServiceAccountEmail,
    });

    const result = await sendOpsWebhook(request, {
      onError: (error) => console.error("Failed to post secret rotation reminder", error),
    });

    try {
      await ctx.runMutation(internal.ops.recordOpsAlertEvent, {
        alertType: "secret_rotation_reminder",
        outcome: result.ok ? "sent" : "failed",
        error: result.ok ? undefined : (result.error instanceof Error ? result.error.message : String(result.error)),
      });
    } catch (recordError) {
      console.error("Failed to record ops alert event", recordError);
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
  handler: async (ctx, args) => {
    const opsConfig = readOpsAlertRuntimeConfig();
    if (!opsConfig.webhookUrl) {
      return null;
    }

    const request = buildSignupAlertRequest(opsConfig, {
      authProvider: args.authProvider,
      initialCredits: args.initialCredits,
      name: args.name,
      userEmail: args.userEmail,
      userId: args.userId,
    });

    const result = await sendOpsWebhook(request, {
      onError: (error) => console.error("Failed to send signup Discord notification", error),
    });

    try {
      await ctx.runMutation(internal.ops.recordOpsAlertEvent, {
        alertType: "signup_alert",
        outcome: result.ok ? "sent" : "failed",
        error: result.ok ? undefined : (result.error instanceof Error ? result.error.message : String(result.error)),
      });
    } catch (recordError) {
      console.error("Failed to record ops alert event", recordError);
    }

    return null;
  },
});

const recentOpsEventValidator = v.object({
  attemptDurationMs: v.optional(v.number()),
  createdAt: v.number(),
  error: v.optional(v.string()),
  eventType: generationOpsEventTypeValidator,
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

const INVESTIGATION_GENERATION_LIMIT = 100;
const INVESTIGATION_TIMELINE_LIMIT = 100;

function clampLimit(value: number | undefined, defaultValue: number, maxValue: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.min(Math.max(Math.floor(value), 1), maxValue);
}

function normalizeInvestigationEmail(email: string | undefined): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function toTimelineEvent(event: Doc<"generationOpsEvents">): OpsTimelineEvent {
  return {
    attemptDurationMs: event.attemptDurationMs,
    createdAt: event.createdAt,
    error: event.error,
    eventType: event.eventType,
    generationDurationMs: event.generationDurationMs,
    retryCount: event.retryCount,
    severity: event.severity,
    stage: event.stage,
    statusMessage: event.statusMessage,
    totalRetryCount: event.totalRetryCount,
  };
}

function latestInternalError(
  events: readonly Doc<"generationOpsEvents">[],
  userFacingError: string | undefined,
): string | undefined {
  const failureEvent = [...events]
    .reverse()
    .find((event) => event.eventType === "generation_failed" && event.error);
  if (!failureEvent?.error || failureEvent.error === userFacingError) {
    return undefined;
  }
  return failureEvent.error;
}

function toGenerationSummary(generation: Doc<"generations">) {
  return {
    completedAt: generation.completedAt,
    createdAt: generation.createdAt,
    creditRefunded: generation.creditRefundedAt !== undefined,
    failureKind: generation.failureKind,
    failureStage: generation.failureStage,
    id: String(generation._id),
    optimizedStorageIdPresent: generation.optimizedStorageId !== undefined,
    prompt: generation.prompt,
    resultStorageIdPresent: generation.resultStorageId !== undefined,
    retryCount: generation.retryCount ?? 0,
    stage: generation.stage,
    status: generation.status,
  };
}

function criticalPathFromVerificationVerdict(
  verdict: Doc<"verificationRuns">["authVerdict"] | undefined,
): CriticalPathVerdict {
  if (!verdict) {
    return "unknown";
  }
  switch (verdict.verdict) {
    case "PASSED":
      return "pass";
    case "FAILED":
    case "TIMEOUT":
      return "fail";
    case "RUNNING":
    case "PENDING":
      return "in_flight";
    case "SKIPPED":
      return "not_applicable";
  }
}

function readDownloadVerdictFromGenerationEvidence(
  payloadJson: string | undefined,
  generationVerdict: CriticalPathVerdict,
): CriticalPathVerdict {
  if (!payloadJson) {
    return generationVerdict === "fail" ? "not_applicable" : "unknown";
  }

  try {
    const payload = JSON.parse(payloadJson) as {
      artifactDownloadReachable?: unknown;
      terminalVerdict?: unknown;
    };
    if (payload.artifactDownloadReachable === true) {
      return "pass";
    }
    if (payload.artifactDownloadReachable === false) {
      return payload.terminalVerdict === "COMPLETE" ? "fail" : "not_applicable";
    }
  } catch {
    return "unknown";
  }

  return generationVerdict === "fail" ? "not_applicable" : "unknown";
}

export const getGenerationInvestigation = internalQuery({
  args: {
    generationId: v.id("generations"),
    now: v.number(),
  },
  returns: generationInvestigationReadModelValidator,
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) {
      return null;
    }

    const [user, opsEvents, userGenerations] = await Promise.all([
      ctx.db.get(generation.userId),
      ctx.db
        .query("generationOpsEvents")
        .withIndex("by_generation", (q) => q.eq("generationId", generation._id))
        .order("asc")
        .take(INVESTIGATION_TIMELINE_LIMIT),
      ctx.db
        .query("generations")
        .withIndex("by_user", (q) => q.eq("userId", generation.userId))
        .order("desc")
        .take(INVESTIGATION_GENERATION_LIMIT),
    ]);

    const boundedGenerations = userGenerations.some((row) => row._id === generation._id)
      ? userGenerations
      : [...userGenerations, generation];
    const laterGenerations = boundedGenerations.filter(
      (row) => row._id !== generation._id && row.createdAt > generation.createdAt,
    );
    const resultUrl = generation.resultStorageId
      ? await ctx.storage.getUrl(generation.resultStorageId)
      : null;
    const optimizedUrl = generation.optimizedStorageId
      ? await ctx.storage.getUrl(generation.optimizedStorageId)
      : null;
    const opsTimeline = opsEvents.map(toTimelineEvent);

    const reportBase = {
      artifacts: {
        optimizedStorageIdPresent: generation.optimizedStorageId !== undefined,
        optimizedUrlIssued: optimizedUrl !== null,
        resultStorageIdPresent: generation.resultStorageId !== undefined,
        resultUrlIssued: resultUrl !== null,
      },
      generation: {
        completedAt: generation.completedAt,
        createdAt: generation.createdAt,
        creditRefunded: generation.creditRefundedAt !== undefined,
        failureKind: generation.failureKind,
        failureStage: generation.failureStage,
        generationTimeMs: generation.generationTimeMs,
        id: String(generation._id),
        internalError: latestInternalError(opsEvents, generation.error),
        retryCount: generation.retryCount ?? 0,
        stage: generation.stage,
        status: generation.status,
        userFacingError: generation.error,
        userId: String(generation.userId),
      },
      opsTimeline,
      user: {
        completedGenerations: boundedGenerations.filter((row) => row.status === "complete").length,
        credits: user?.credits,
        email: user?.email,
        failedGenerations: boundedGenerations.filter((row) => row.status === "failed").length,
        id: String(generation.userId),
        laterCompletedGenerations: laterGenerations.filter((row) => row.status === "complete").length,
        laterGenerations: laterGenerations.length,
        totalGenerations: boundedGenerations.length,
      },
    };

    const report = {
      ...reportBase,
      verdict: buildGenerationInvestigationVerdict({
        artifacts: reportBase.artifacts,
        creditRefunded: reportBase.generation.creditRefunded,
        createdAt: generation.createdAt,
        laterCompletedGenerations: reportBase.user.laterCompletedGenerations,
        laterGenerations: reportBase.user.laterGenerations,
        now: args.now,
        opsTimeline,
        retryCount: reportBase.generation.retryCount,
        status: generation.status,
      }),
    };

    return {
      artifactUrls: {
        optimizedUrl: optimizedUrl ?? undefined,
        resultUrl: resultUrl ?? undefined,
      },
      report,
    };
  },
});

export const getUserInvestigation = internalQuery({
  args: {
    email: v.optional(v.string()),
    limit: v.optional(v.number()),
    now: v.number(),
    userId: v.optional(v.id("users")),
  },
  returns: userInvestigationReportValidator,
  handler: async (ctx, args) => {
    const email = normalizeInvestigationEmail(args.email);
    const user = args.userId
      ? await ctx.db.get(args.userId)
      : email
        ? await ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", email))
          .first()
        : null;

    if (!user) {
      return null;
    }

    const limit = clampLimit(args.limit, 10, 25);
    const latestGenerations = await ctx.db
      .query("generations")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
    const summaries = latestGenerations.map(toGenerationSummary);
    const completedCount = summaries.filter((generation) => generation.status === "complete").length;
    const failedCount = summaries.filter((generation) => generation.status === "failed").length;
    const inFlightCount = summaries.filter((generation) => generation.status === "generating").length;
    const latestComplete = summaries.find((generation) => generation.status === "complete");
    const latestFailed = summaries.find((generation) => generation.status === "failed");

    const auth: CriticalPathVerdict =
      user.clerkUserId || user.tokenIdentifier ? "pass" : "fail";
    const generation: CriticalPathVerdict =
      inFlightCount > 0
        ? "in_flight"
        : latestComplete
          ? "pass"
          : latestFailed
            ? "fail"
            : "unknown";
    const download: CriticalPathVerdict = latestComplete ? "unknown" : "not_applicable";
    const recommendedAction =
      auth === "fail"
        ? "Inspect account provisioning; no Clerk or Convex token binding is present."
        : generation === "fail"
          ? "Inspect the latest failed generation for refund and retry evidence."
          : generation === "unknown"
            ? "No generation rows are visible for this user yet."
            : "Inspect a specific generation if artifact downloadability matters.";

    return {
      authBinding: {
        clerkUserIdPresent: user.clerkUserId !== undefined,
        tokenIdentifierPresent: user.tokenIdentifier !== undefined,
      },
      latestGenerations: summaries,
      user: {
        credits: user.credits,
        email: user.email,
        id: String(user._id),
      },
      verdict: {
        auth,
        download,
        generation,
        recommendedAction,
      },
      window: {
        limit,
        now: args.now,
      },
    };
  },
});

export const getRecentGenerationIncidents = internalQuery({
  args: {
    hoursWindow: v.optional(v.number()),
    limit: v.optional(v.number()),
    now: v.number(),
  },
  returns: recentGenerationIncidentsReportValidator,
  handler: async (ctx, args) => {
    const hoursWindow = clampHoursWindow(args.hoursWindow);
    const limit = clampLimit(args.limit, 5, 50);
    const since = args.now - hoursWindow * 60 * 60 * 1000;
    const eventTypes = ["generation_failed", "generation_stalled", "alert_failed"] as const;

    const eventGroups = await Promise.all(
      eventTypes.map((eventType) =>
        ctx.db
          .query("generationOpsEvents")
          .withIndex("by_eventType_createdAt", (q) =>
            q.eq("eventType", eventType).gte("createdAt", since)
          )
          .order("desc")
          .take(limit),
      ),
    );

    const incidents = eventGroups
      .flat()
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit)
      .map((event) => ({
        attemptDurationMs: event.attemptDurationMs,
        createdAt: event.createdAt,
        error: event.error,
        eventType: event.eventType as "generation_failed" | "generation_stalled" | "alert_failed",
        generationDurationMs: event.generationDurationMs,
        generationId: String(event.generationId),
        retryCount: event.retryCount,
        severity: event.severity,
        stage: event.stage,
        statusMessage: event.statusMessage,
        totalRetryCount: event.totalRetryCount,
        userEmail: event.userEmail,
        userId: String(event.userId),
      }));

    return {
      incidents,
      window: {
        hoursWindow,
        limit,
        now: args.now,
        since,
      },
    };
  },
});

async function getEvidencePayload(
  ctx: QueryCtx,
  evidenceRef: string | undefined,
): Promise<{ evidenceRef: string; payloadJson?: string } | null> {
  if (!evidenceRef) {
    return null;
  }
  const row = await ctx.db
    .query("verificationEvidence")
    .withIndex("by_evidence_ref", (q) => q.eq("evidenceRef", evidenceRef))
    .first();
  return {
    evidenceRef,
    payloadJson: row?.payloadJson,
  };
}

export const getLatestCriticalPathHealth = internalQuery({
  args: {
    now: v.number(),
  },
  returns: criticalPathHealthReportValidator,
  handler: async (ctx, args) => {
    const triggers = ["POST_DEPLOY", "SCHEDULED"] as const;
    const latestByTrigger = await Promise.all(
      triggers.map((trigger) =>
        ctx.db
          .query("verificationRuns")
          .withIndex("by_trigger_startedAt", (q) => q.eq("trigger", trigger))
          .order("desc")
          .first(),
      ),
    );
    const latestRun = latestByTrigger
      .filter((run): run is NonNullable<typeof run> => run !== null)
      .sort((left, right) => right.startedAt - left.startedAt)[0] ?? null;

    if (!latestRun) {
      return {
        evidence: {
          auth: null,
          generation: null,
        },
        latestRun: null,
        verdict: {
          auth: "unknown" as const,
          download: "unknown" as const,
          generation: "unknown" as const,
          recommendedAction: "No production verification run is recorded yet.",
        },
      };
    }

    const [authEvidence, generationEvidence] = await Promise.all([
      getEvidencePayload(ctx, latestRun.authVerdict?.evidenceRef),
      getEvidencePayload(ctx, latestRun.generationVerdict?.evidenceRef),
    ]);
    const auth = criticalPathFromVerificationVerdict(latestRun.authVerdict);
    const generation = criticalPathFromVerificationVerdict(latestRun.generationVerdict);
    const download = readDownloadVerdictFromGenerationEvidence(
      generationEvidence?.payloadJson,
      generation,
    );
    const stale = args.now - latestRun.startedAt > 24 * 60 * 60 * 1000;
    const recommendedAction = stale
      ? "Run production verification; latest evidence is older than 24 hours."
      : auth === "pass" && generation === "pass" && download === "pass"
        ? "No action needed; latest critical-path evidence is passing."
        : "Inspect the failing domain evidence before declaring production healthy.";

    return {
      evidence: {
        auth: authEvidence,
        generation: generationEvidence,
      },
      latestRun: {
        ageMs: args.now - latestRun.startedAt,
        authVerdict: latestRun.authVerdict,
        checkoutSessionVerdict: latestRun.checkoutSessionVerdict,
        deploymentId: latestRun.deploymentId,
        finishedAt: latestRun.finishedAt,
        generationVerdict: latestRun.generationVerdict,
        gitSha: latestRun.gitSha,
        liveSettlementVerdict: latestRun.liveSettlementVerdict,
        releaseDecision: latestRun.releaseDecision,
        runKey: latestRun.runKey,
        siteUrl: latestRun.siteUrl,
        startedAt: latestRun.startedAt,
        trigger: latestRun.trigger,
        workflowRunId: latestRun.workflowRunId,
      },
      verdict: {
        auth,
        download,
        generation,
        recommendedAction,
      },
    };
  },
});

export const listRecentSignups = internalQuery({
  args: {
    hoursWindow: v.optional(v.number()),
    limit: v.optional(v.number()),
    now: v.number(),
  },
  returns: recentSignupsReportValidator,
  handler: async (ctx, args) => {
    const hoursWindow = clampHoursWindow(args.hoursWindow);
    const limit = clampLimit(args.limit, 10, 50);
    const since = args.now - hoursWindow * 60 * 60 * 1000;

    const recentUsers = await ctx.db
      .query("users")
      .filter((q) => q.gte(q.field("_creationTime"), since))
      .order("desc")
      .take(limit);

    return {
      signups: recentUsers.map((user) => ({
        createdAt: user._creationTime,
        credits: user.credits,
        email: user.email,
        id: String(user._id),
        name: user.name,
      })),
      window: {
        hoursWindow,
        limit,
        now: args.now,
        since,
      },
    };
  },
});

export const getRecentOpsAlertEvents = internalQuery({
  args: {
    hoursWindow: v.optional(v.number()),
    limit: v.optional(v.number()),
    now: v.number(),
  },
  returns: v.object({
    events: v.array(
      v.object({
        alertType: v.union(
          v.literal("signup_alert"),
          v.literal("purchase_alert"),
          v.literal("secret_rotation_reminder"),
          v.literal("email_delivery_alert"),
        ),
        createdAt: v.number(),
        error: v.optional(v.string()),
        outcome: v.union(v.literal("sent"), v.literal("failed")),
      }),
    ),
    window: v.object({
      hoursWindow: v.number(),
      limit: v.number(),
      now: v.number(),
      since: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const hoursWindow = clampHoursWindow(args.hoursWindow);
    const limit = clampLimit(args.limit, 20, 100);
    const since = args.now - hoursWindow * 60 * 60 * 1000;

    const events = await ctx.db
      .query("opsAlertEvents")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", since))
      .order("desc")
      .take(limit);

    return {
      events: events.map((event) => ({
        alertType: event.alertType,
        createdAt: event.createdAt,
        error: event.error,
        outcome: event.outcome,
      })),
      window: {
        hoursWindow,
        limit,
        now: args.now,
        since,
      },
    };
  },
});
