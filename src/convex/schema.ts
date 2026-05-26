import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  canaryPrincipalBindingFields,
  animationAttributionValidator,
  animationBrandInputsValidator,
  animationDestinationValidator,
  animationExportsValidator,
  animationGenerationStatusValidator,
  animationQaValidator,
  animationUseCaseValidator,
  creditGrantReasonValidator,
  generationStageValidator,
  transparentQaValidator,
  verificationEvidenceFields,
  verificationRunFields,
} from "./lib/validation/validators.js";

export default defineSchema({
  mcpApiKeys: defineTable({
    userId: v.id("users"),
    keyHash: v.string(),
    keyPrefix: v.string(),
    name: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_key_hash", ["keyHash"])
    .index("by_user", ["userId"])
    .index("by_user_createdAt", ["userId", "createdAt"]),

  users: defineTable({
    tokenIdentifier: v.optional(v.string()),
    /** Prior Convex auth subjects (e.g. Better Auth era); retained for rollback forensics. */
    legacyAuthSubjects: v.optional(v.array(v.string())),
    /** WorkOS User Management subject (`sub`); stable provider-side user id. */
    workosUserId: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    credits: v.optional(v.number()),
    stripeCustomerId: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("by_token", ["tokenIdentifier"])
    .index("by_workos_user", ["workosUserId"]),

  generations: defineTable({
    userId: v.id("users"),
    prompt: v.string(),
    status: v.union(
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed")
    ),
    stage: v.optional(generationStageValidator),
    statusMessage: v.optional(v.string()),
    resultStorageId: v.optional(v.id("_storage")),
    whiteBgStorageId: v.optional(v.id("_storage")),
    blackBgStorageId: v.optional(v.id("_storage")),
    optimizedStorageId: v.optional(v.id("_storage")),
    referenceStorageId: v.optional(v.id("_storage")),
    referenceStorageIds: v.optional(v.array(v.id("_storage"))),
    creditsCost: v.number(),
    aspectRatio: v.string(),
    createdAt: v.number(),
    lastProgressAt: v.optional(v.number()),
    stageStartedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    failureKind: v.optional(v.union(
      v.literal("timeout"),
      v.literal("provider_error"),
      v.literal("processing_error"),
      v.literal("unknown")
    )),
    failureStage: v.optional(generationStageValidator),
    transparentQa: v.optional(transparentQaValidator),
    generationTimeMs: v.optional(v.number()),
    retryCount: v.optional(v.number()),
    whiteBgRetryCount: v.optional(v.number()),
    blackBgRetryCount: v.optional(v.number()),
    finalizeRetryCount: v.optional(v.number()),
    whiteBgRetryInstruction: v.optional(v.string()),
    blackBgRetryInstruction: v.optional(v.string()),
    dimensionMismatch: v.optional(v.boolean()),
    stalledAlertedAt: v.optional(v.number()),
    creditRefundedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_status", ["userId", "status"])
    .index("by_createdAt", ["createdAt"])
    .index("by_status", ["status"]),

  animationGenerations: defineTable({
    userId: v.id("users"),
    prompt: v.string(),
    useCase: animationUseCaseValidator,
    destination: animationDestinationValidator,
    productionBrief: v.optional(v.string()),
    status: animationGenerationStatusValidator,
    statusMessage: v.optional(v.string()),
    aspectRatio: v.string(),
    durationSeconds: v.number(),
    creditsCost: v.number(),
    stageStartedAt: v.optional(v.number()),
    lastProgressAt: v.optional(v.number()),
    retryCount: v.number(),
    creditRefundedAt: v.optional(v.number()),
    referenceGenerationId: v.optional(v.id("generations")),
    uploadedReferenceStorageIds: v.optional(v.array(v.id("_storage"))),
    brandInputs: v.optional(animationBrandInputsValidator),
    attribution: v.optional(animationAttributionValidator),
    veoOperationName: v.optional(v.string()),
    veoOutputGcsUri: v.optional(v.string()),
    canonicalFrameManifestStorageId: v.optional(v.id("_storage")),
    previewStorageId: v.optional(v.id("_storage")),
    exports: v.optional(animationExportsValidator),
    animationQa: v.optional(animationQaValidator),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_status_created", ["userId", "status", "createdAt"])
    .index("by_status_last_progress", ["status", "lastProgressAt"])
    .index("by_veo_operation", ["veoOperationName"])
    .index("by_attribution_campaign_created", ["attribution.campaignId", "createdAt"])
    .index("by_attribution_creator_code_created", ["attribution.creatorCode", "createdAt"]),

  generationOpsEvents: defineTable({
    generationId: v.id("generations"),
    userId: v.id("users"),
    userEmail: v.optional(v.string()),
    eventType: v.union(
      v.literal("generation_requested"),
      v.literal("stage_succeeded"),
      v.literal("stage_retry_scheduled"),
      v.literal("generation_completed"),
      v.literal("generation_failed"),
      v.literal("generation_stalled"),
      v.literal("alert_sent"),
      v.literal("alert_failed")
    ),
    severity: v.optional(v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical")
    )),
    stage: v.optional(generationStageValidator),
    attemptDurationMs: v.optional(v.number()),
    generationDurationMs: v.optional(v.number()),
    retryCount: v.optional(v.number()),
    totalRetryCount: v.optional(v.number()),
    statusMessage: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_generation", ["generationId", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_eventType_createdAt", ["eventType", "createdAt"]),

  creditGrants: defineTable({
    userId: v.id("users"),
    amount: v.number(),
    reason: creditGrantReasonValidator,
    stripePaymentIntentId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_payment_intent", ["stripePaymentIntentId"]),

  pendingCheckouts: defineTable({
    userId: v.id("users"),
    priceId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("failed")
    ),
    checkoutUrl: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    // Processing lease for the action that creates the Stripe Checkout
    // Session. Set atomically by `claimCheckoutForProcessing`. A non-null
    // value within the lease TTL means a `processCheckout` invocation is
    // mid-flight and any concurrent replay must skip the Stripe side
    // effect. `processingLeaseId` binds terminal transitions to the owner
    // that acquired the lease, so an action whose lease was later reclaimed
    // cannot mark the newer owner failed/ready.
    processingStartedAt: v.optional(v.number()),
    processingLeaseId: v.optional(v.string()),
  })
    .index("by_user_status", ["userId", "status"])
    .index("by_stripe_checkout_session", ["stripeCheckoutSessionId"]),

  purchaseSettlements: defineTable({
    stripePaymentIntentId: v.string(),
    stripeCheckoutSessionId: v.string(),
    pendingCheckoutId: v.union(v.id("pendingCheckouts"), v.null()),
    userId: v.id("users"),
    priceId: v.string(),
    creditsGranted: v.number(),
    amountUsd: v.number(),
    currency: v.string(),
    creditGrantCreatedAt: v.number(),
    revenueEventCreatedAt: v.number(),
    refundRequestedAt: v.optional(v.number()),
    refundedAt: v.optional(v.number()),
    stripeRefundId: v.optional(v.string()),
    refundAmountUsd: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_payment_intent", ["stripePaymentIntentId"])
    .index("by_checkout_session", ["stripeCheckoutSessionId"])
    .index("by_pending_checkout", ["pendingCheckoutId"])
    .index("by_user", ["userId"])
    .index("by_createdAt", ["createdAt"]),

  pendingPurchaseRefunds: defineTable({
    stripePaymentIntentId: v.string(),
    stripeRefundId: v.string(),
    refundAmountUsd: v.number(),
    refundedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_payment_intent", ["stripePaymentIntentId"])
    .index("by_refund", ["stripeRefundId"])
    .index("by_createdAt", ["createdAt"]),

  canaryPrincipals: defineTable({
    ...canaryPrincipalBindingFields,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_principal_id", ["principalId"])
    .index("by_email", ["email"]),

  verificationEvidence: defineTable({
    ...verificationEvidenceFields,
    createdAt: v.number(),
  })
    .index("by_evidence_ref", ["evidenceRef"])
    .index("by_run_key_createdAt", ["runKey", "createdAt"]),

  verificationRuns: defineTable(verificationRunFields)
    .index("by_run_key", ["runKey"])
    .index("by_trigger_startedAt", ["trigger", "startedAt"])
    .index("by_deployment_trigger_startedAt", ["deploymentId", "trigger", "startedAt"]),

  referenceUploadUrlIssues: defineTable({
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_user_createdAt", ["userId", "createdAt"])
    .index("by_createdAt", ["createdAt"]),
});
