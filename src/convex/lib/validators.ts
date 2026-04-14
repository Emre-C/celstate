import { v } from "convex/values";

/**
 * Single source of truth for pipeline stage literals (schema + public/internal args).
 */
export const generationStageValidator = v.union(
  v.literal("white_background"),
  v.literal("black_background"),
  v.literal("finalizing"),
);

export const creditGrantReasonValidator = v.union(
  v.literal("signup_bonus"),
  v.literal("weekly_drip"),
  v.literal("purchase"),
  v.literal("admin_grant"),
);

export const featureDomainValidator = v.union(
  v.literal("AUTH"),
  v.literal("GENERATION"),
  v.literal("CHECKOUT_SESSION"),
  v.literal("LIVE_SETTLEMENT"),
);

export const verificationTriggerValidator = v.union(
  v.literal("PRE_MERGE_CI"),
  v.literal("POST_DEPLOY"),
  v.literal("SCHEDULED"),
);

export const requirementClassValidator = v.union(
  v.literal("REQUIRED_ON_DEPLOY"),
  v.literal("REQUIRED_ON_SCHEDULE"),
  v.literal("OPTIONAL"),
);

export const verdictValidator = v.union(
  v.literal("PENDING"),
  v.literal("RUNNING"),
  v.literal("PASSED"),
  v.literal("FAILED"),
  v.literal("SKIPPED"),
  v.literal("TIMEOUT"),
);

export const settlementOutcomeValidator = v.union(
  v.literal("UNOBSERVED"),
  v.literal("GRANTED_ONCE"),
  v.literal("DUPLICATE_GRANT"),
  v.literal("REFUNDED"),
  v.literal("FAILED"),
);

export const canaryPrincipalIdValidator = v.union(
  v.literal("CANARY_AUTH"),
  v.literal("CANARY_GENERATION"),
  v.literal("CANARY_CHECKOUT"),
  v.literal("CANARY_SETTLEMENT"),
);

export const verificationReleaseDecisionValidator = v.union(
  v.literal("ALLOW"),
  v.literal("DENY"),
);

export const canaryPrincipalBindingFields = {
  principalId: canaryPrincipalIdValidator,
  domain: featureDomainValidator,
  destructive: v.boolean(),
  email: v.string(),
  name: v.string(),
  betterAuthUserId: v.string(),
  minimumCredits: v.number(),
  appUserId: v.union(v.id("users"), v.null()),
};

export const canaryPrincipalBindingValidator = v.object(canaryPrincipalBindingFields);

export const verificationEvidenceFields = {
  evidenceRef: v.string(),
  runKey: v.string(),
  domain: featureDomainValidator,
  trigger: verificationTriggerValidator,
  payloadJson: v.string(),
};

export const verificationEvidenceValidator = v.object(verificationEvidenceFields);

/** Matches `domainVerdictValidator` in schema (single source for verification APIs). */
export const domainVerdictRecordValidator = v.object({
  domain: featureDomainValidator,
  trigger: verificationTriggerValidator,
  requirement: requirementClassValidator,
  verdict: verdictValidator,
  evidenceRef: v.string(),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  note: v.optional(v.string()),
  // Populated for LIVE_SETTLEMENT probes; absent for other domains.
  settlementOutcome: v.optional(settlementOutcomeValidator),
});

export const verificationRunFields = {
  runKey: v.string(),
  trigger: verificationTriggerValidator,
  deploymentId: v.optional(v.string()),
  gitSha: v.optional(v.string()),
  siteUrl: v.optional(v.string()),
  workflowRunId: v.optional(v.string()),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  releaseDecision: v.optional(verificationReleaseDecisionValidator),
  requiredDomains: v.array(featureDomainValidator),
  authVerdict: v.optional(domainVerdictRecordValidator),
  generationVerdict: v.optional(domainVerdictRecordValidator),
  checkoutSessionVerdict: v.optional(domainVerdictRecordValidator),
  liveSettlementVerdict: v.optional(domainVerdictRecordValidator),
};

export const verificationRunValidator = v.object({
  _id: v.id("verificationRuns"),
  _creationTime: v.number(),
  ...verificationRunFields,
});
