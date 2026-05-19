import { v } from "convex/values";

/**
 * Single source of truth for pipeline stage literals (schema + public/internal args).
 */
export const generationStageValidator = v.union(
  v.literal("white_background"),
  v.literal("black_background"),
  v.literal("finalizing"),
);

export const animationUseCaseValidator = v.union(
  v.literal("stream_alert"),
  v.literal("stinger_transition"),
  v.literal("mascot_reaction"),
  v.literal("logo_sting"),
  v.literal("lower_third"),
  v.literal("video_callout"),
  v.literal("creator_overlay"),
);

export const animationDestinationValidator = v.union(
  v.literal("obs"),
  v.literal("video_editor"),
  v.literal("obs_and_video_editor"),
);

export const animationGenerationStatusValidator = v.union(
  v.literal("intake"),
  v.literal("queued"),
  v.literal("generating_reference"),
  v.literal("submitting_video"),
  v.literal("polling_video"),
  v.literal("reconstructing_alpha"),
  v.literal("qa"),
  v.literal("exporting"),
  v.literal("complete"),
  v.literal("failed"),
);

const animationTextBrandInputFields = {
  channelName: v.optional(v.string()),
  colors: v.optional(v.array(v.string())),
  creatorHandle: v.optional(v.string()),
} as const;

export const animationPublicBrandInputsValidator = v.object(animationTextBrandInputFields);

export const animationBrandInputsValidator = v.object({
  ...animationTextBrandInputFields,
  logoStorageId: v.optional(v.id("_storage")),
});

export const animationAttributionSourceValidator = v.union(
  v.literal("organic"),
  v.literal("tiktok_creator"),
  v.literal("spark_ad"),
  v.literal("direct_outreach"),
  v.literal("other"),
);

export const animationAttributionValidator = v.object({
  campaignId: v.optional(v.string()),
  creatorCode: v.optional(v.string()),
  landingPageVariant: v.optional(v.string()),
  source: v.optional(animationAttributionSourceValidator),
});

export const animationExportsValidator = v.object({
  apngStorageId: v.optional(v.id("_storage")),
  movStorageId: v.optional(v.id("_storage")),
  obsBundleStorageId: v.optional(v.id("_storage")),
  pngSequenceStorageId: v.optional(v.id("_storage")),
  webmStorageId: v.optional(v.id("_storage")),
});

export const animationQaDecisionValidator = v.union(
  v.literal("pass"),
  v.literal("rerun_veo"),
  v.literal("rerun_reference"),
  v.literal("repair_alpha"),
  v.literal("fail_refund"),
  v.literal("review"),
);

export const animationQaReasonCodeValidator = v.union(
  v.literal("alpha_missing_frame"),
  v.literal("border_contact"),
  v.literal("boundary_flicker_high"),
  v.literal("component_instability_high"),
  v.literal("edge_spill_high"),
  v.literal("export_alpha_lost"),
  v.literal("loop_seam_high"),
  v.literal("reference_identity_drift"),
  v.literal("subject_cropped"),
  v.literal("transparent_region_contaminated"),
);

export const animationQaMetricsValidator = v.object({
  alphaFrameCoverage: v.number(),
  borderTransparencyMin: v.number(),
  boundaryFlicker: v.number(),
  componentStability: v.number(),
  decodedExportAlphaCoverage: v.number(),
  durationSeconds: v.number(),
  edgeSpill: v.number(),
  frameCount: v.number(),
  loopSeamScore: v.number(),
});

export const animationQaValidator = v.object({
  decision: animationQaDecisionValidator,
  metrics: animationQaMetricsValidator,
  reasonCodes: v.array(animationQaReasonCodeValidator),
  version: v.string(),
});

export const transparentQaDecisionValidator = v.union(
  v.literal("pass"),
  v.literal("retry_black"),
  v.literal("retry_white_and_black"),
  v.literal("review"),
);

export const transparentQaReasonCodeValidator = v.union(
  v.literal("white_recomposition_residual_high"),
  v.literal("black_recomposition_residual_high"),
  v.literal("channel_disagreement_high"),
  v.literal("alpha_residual_high"),
  v.literal("alpha_presence_low"),
  v.literal("border_transparency_ratio_low"),
  v.literal("dimension_mismatch"),
  v.literal("boundary_error_rate_high"),
  v.literal("external_spill_high"),
  v.literal("halo_tail_high"),
  v.literal("fragment_noise_high"),
  v.literal("topology_volatility_high"),
  v.literal("expected_hole_missing"),
);

export const transparentQaTopologySampleValidator = v.object({
  threshold: v.number(),
  foregroundAreaRatio: v.number(),
  foregroundComponentCount: v.number(),
  holeCount: v.number(),
  holeAreaRatio: v.number(),
});

export const transparentQaMetricsValidator = v.object({
  alphaPresence: v.number(),
  transparentPixelRatio: v.number(),
  borderTransparencyRatio: v.number(),
  whiteRecompositionResidual: v.number(),
  blackRecompositionResidual: v.number(),
  recompositionResidual: v.number(),
  channelDisagreement: v.number(),
  alphaResidual: v.number(),
  boundaryErrorRate: v.number(),
  externalSpill: v.number(),
  haloTail: v.number(),
  persistentHoleCount: v.number(),
  persistentHoleAreaRatio: v.number(),
  fragileHoleCount: v.number(),
  topologyVolatility: v.number(),
  fragmentNoise: v.number(),
  dimensionMismatchPenalty: v.number(),
  holeKeywordMatched: v.boolean(),
  holeKeywordCount: v.number(),
  topologySamples: v.array(transparentQaTopologySampleValidator),
});

export const transparentQaValidator = v.object({
  version: v.string(),
  decision: transparentQaDecisionValidator,
  reasonCodes: v.array(transparentQaReasonCodeValidator),
  metrics: transparentQaMetricsValidator,
});

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
  workosUserId: v.string(),
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
