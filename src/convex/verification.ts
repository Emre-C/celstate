import { v } from "convex/values";
import { components } from "./_generated/api.js";
import { internalMutation, internalQuery } from "./_generated/server.js";
import {
  canaryPrincipalIdValidator,
  domainVerdictRecordValidator,
  featureDomainValidator,
  verificationTriggerValidator,
} from "./lib/validators.js";
import { assertVerificationRunnerSecret } from "./lib/verificationRunnerSecret.js";
import {
  CANARY_PRINCIPAL_CONFIG,
  DEFAULT_GATE_CONFIG,
  assertValidGateConfig,
  evaluateReleaseDecision,
  type FeatureDomain,
  type GateConfig,
} from "../lib/production-confidence.js";

const canaryPrincipalBindingValidator = v.object({
  principalId: canaryPrincipalIdValidator,
  domain: featureDomainValidator,
  destructive: v.boolean(),
  email: v.string(),
  name: v.string(),
  betterAuthUserId: v.string(),
  minimumCredits: v.number(),
  appUserId: v.union(v.id("users"), v.null()),
});

type BetterAuthUserRecord = {
  email?: string;
  emailVerified?: boolean;
  name?: string;
  userId?: string;
};

async function resolveCanonicalBetterAuthUser(
  ctx: { runQuery: (...args: any[]) => Promise<unknown> },
  email: string,
): Promise<Required<Pick<BetterAuthUserRecord, "email" | "userId">> & BetterAuthUserRecord> {
  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    select: ["email", "emailVerified", "name", "userId"],
    where: [{ field: "email", operator: "eq", value: email }],
  })) as BetterAuthUserRecord | null;

  if (!user?.userId || typeof user.email !== "string") {
    throw new Error(`Canonical Better Auth user not found for ${email}`);
  }

  if (user.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error(`Canonical Better Auth user email mismatch for ${email}`);
  }

  if (user.emailVerified !== true) {
    throw new Error(`Canonical Better Auth user must have a verified email for ${email}`);
  }

  return user as Required<Pick<BetterAuthUserRecord, "email" | "userId">> & BetterAuthUserRecord;
}

export const getCanaryPrincipalById = internalQuery({
  args: { principalId: canaryPrincipalIdValidator },
  returns: v.union(canaryPrincipalBindingValidator, v.null()),
  handler: async (ctx, args) => {
    const principal = await ctx.db
      .query("canaryPrincipals")
      .withIndex("by_principal_id", (q) => q.eq("principalId", args.principalId))
      .first();

    if (!principal) {
      return null;
    }

    return {
      principalId: principal.principalId,
      domain: principal.domain,
      destructive: principal.destructive,
      email: principal.email,
      name: principal.name,
      betterAuthUserId: principal.betterAuthUserId,
      minimumCredits: principal.minimumCredits,
      appUserId: principal.appUserId,
    };
  },
});

export const upsertCanaryPrincipal = internalMutation({
  args: {
    runnerSecret: v.string(),
    principalId: canaryPrincipalIdValidator,
  },
  returns: v.id("canaryPrincipals"),
  handler: async (ctx, args) => {
    assertVerificationRunnerSecret(args.runnerSecret);
    const cfg = CANARY_PRINCIPAL_CONFIG[args.principalId];
    const now = Date.now();
    const authUser = await resolveCanonicalBetterAuthUser(ctx, cfg.email);
    const matchingAppUsers = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", cfg.email))
      .take(2);

    if (matchingAppUsers.length !== 1) {
      throw new Error(
        matchingAppUsers.length === 0
          ? `Canonical app user not found for ${cfg.email}`
          : `Multiple app users matched canonical canary email ${cfg.email}`,
      );
    }

    const appUser = matchingAppUsers[0]!;
    if ((appUser.credits ?? 0) < cfg.minimumCredits) {
      throw new Error(
        `${args.principalId} requires at least ${cfg.minimumCredits} credits but has ${appUser.credits ?? 0}`,
      );
    }
    if (args.principalId === "CANARY_SETTLEMENT" && !appUser.stripeCustomerId) {
      throw new Error(
        "CANARY_SETTLEMENT requires an existing Stripe customer ID with a saved payment method",
      );
    }

    const existing = await ctx.db
      .query("canaryPrincipals")
      .withIndex("by_principal_id", (q) => q.eq("principalId", args.principalId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        domain: cfg.proves,
        destructive: cfg.destructive,
        email: cfg.email,
        name: cfg.name,
        betterAuthUserId: authUser.userId,
        minimumCredits: cfg.minimumCredits,
        appUserId: appUser._id,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("canaryPrincipals", {
      principalId: args.principalId,
      domain: cfg.proves,
      destructive: cfg.destructive,
      email: cfg.email,
      name: cfg.name,
      minimumCredits: cfg.minimumCredits,
      betterAuthUserId: authUser.userId,
      appUserId: appUser._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

const evidenceRowValidator = v.object({
  evidenceRef: v.string(),
  runKey: v.string(),
  domain: featureDomainValidator,
  trigger: verificationTriggerValidator,
  payloadJson: v.string(),
});

const gateConfigArgsValidator = v.object({
  requiredOnDeploy: v.array(featureDomainValidator),
  requiredOnSchedule: v.array(featureDomainValidator),
});

export const ingestVerificationRun = internalMutation({
  args: {
    runnerSecret: v.string(),
    runKey: v.string(),
    trigger: verificationTriggerValidator,
    deploymentId: v.optional(v.string()),
    gitSha: v.optional(v.string()),
    siteUrl: v.optional(v.string()),
    workflowRunId: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.number(),
    gateConfig: v.optional(gateConfigArgsValidator),
    authVerdict: v.optional(domainVerdictRecordValidator),
    generationVerdict: v.optional(domainVerdictRecordValidator),
    checkoutSessionVerdict: v.optional(domainVerdictRecordValidator),
    liveSettlementVerdict: v.optional(domainVerdictRecordValidator),
    evidenceRows: v.array(evidenceRowValidator),
  },
  returns: v.object({
    releaseDecision: v.union(v.literal("ALLOW"), v.literal("DENY")),
  }),
  handler: async (ctx, args) => {
    assertVerificationRunnerSecret(args.runnerSecret);

    const verdictRecords = [
      args.authVerdict,
      args.generationVerdict,
      args.checkoutSessionVerdict,
      args.liveSettlementVerdict,
    ].filter((x): x is NonNullable<typeof args.authVerdict> => x !== undefined);

    const gateConfig: GateConfig = args.gateConfig ?? DEFAULT_GATE_CONFIG;
    if (args.gateConfig) {
      assertValidGateConfig(gateConfig);
    }

    const evaluation = evaluateReleaseDecision({
      trigger: args.trigger,
      verdicts: verdictRecords,
      gateConfig,
    });

    const existing = await ctx.db
      .query("verificationRuns")
      .withIndex("by_run_key", (q) => q.eq("runKey", args.runKey))
      .first();

    const row = {
      runKey: args.runKey,
      trigger: args.trigger,
      deploymentId: args.deploymentId,
      gitSha: args.gitSha,
      siteUrl: args.siteUrl,
      workflowRunId: args.workflowRunId,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      releaseDecision: evaluation.releaseDecision,
      requiredDomains: evaluation.requiredDomains as FeatureDomain[],
      authVerdict: args.authVerdict,
      generationVerdict: args.generationVerdict,
      checkoutSessionVerdict: args.checkoutSessionVerdict,
      liveSettlementVerdict: args.liveSettlementVerdict,
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("verificationRuns", row);
    }

    for (const ev of args.evidenceRows) {
      const dup = await ctx.db
        .query("verificationEvidence")
        .withIndex("by_evidence_ref", (q) => q.eq("evidenceRef", ev.evidenceRef))
        .first();
      if (!dup) {
        await ctx.db.insert("verificationEvidence", {
          evidenceRef: ev.evidenceRef,
          runKey: ev.runKey,
          domain: ev.domain,
          trigger: ev.trigger,
          payloadJson: ev.payloadJson,
          createdAt: Date.now(),
        });
      }
    }

    return { releaseDecision: evaluation.releaseDecision };
  },
});
