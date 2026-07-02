import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  canaryPrincipalBindingFields,
  creditGrantReasonValidator,
  generationFailureKindValidator,
  generationOpsEventTypeValidator,
  generationStageValidator,
  generationStatusValidator,
  lottieGenerationStatusValidator,
  lottieValidationValidator,
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
    clerkUserId: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    credits: v.optional(v.number()),
    stripeCustomerId: v.optional(v.string()),
    welcomeEmailStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped"),
    )),
    welcomeEmailAttempts: v.optional(v.number()),
    welcomeEmailSentAt: v.optional(v.number()),
    emailUnsubscribed: v.optional(v.boolean()),
    welcomeEmailBonusCreditsGranted: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("by_token", ["tokenIdentifier"])
    .index("by_clerk_user", ["clerkUserId"])
    .index("by_welcome_email_status", ["welcomeEmailStatus"]),

  generations: defineTable({
    userId: v.id("users"),
    prompt: v.string(),
    status: generationStatusValidator,
    stage: v.optional(generationStageValidator),
    statusMessage: v.optional(v.string()),
    resultStorageId: v.optional(v.id("_storage")),
    whiteBgStorageId: v.optional(v.id("_storage")),
    blackBgStorageId: v.optional(v.id("_storage")),
    optimizedStorageId: v.optional(v.id("_storage")),
    referenceStorageIds: v.optional(v.array(v.id("_storage"))),
    creditsCost: v.number(),
    aspectRatio: v.string(),
    createdAt: v.number(),
    lastProgressAt: v.optional(v.number()),
    stageStartedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    failureKind: v.optional(generationFailureKindValidator),
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
    downloadedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_status", ["userId", "status"])
    .index("by_createdAt", ["createdAt"])
    .index("by_status", ["status"]),

  lottieGenerations: defineTable({
    userId: v.id("users"),
    prompt: v.string(),
    grounding: v.optional(v.string()),
    status: lottieGenerationStatusValidator,
    statusMessage: v.optional(v.string()),
    aspectRatio: v.string(),
    durationSeconds: v.number(),
    fps: v.number(),
    createdAt: v.number(),
    lastProgressAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    attemptCount: v.number(),
    creditsCost: v.number(),
    creditRefundedAt: v.optional(v.number()),
    lottieStorageId: v.optional(v.id("_storage")),
    validation: v.optional(lottieValidationValidator),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_status_created", ["userId", "status", "createdAt"])
    .index("by_status_last_progress", ["status", "lastProgressAt"])
    .index("by_createdAt", ["createdAt"]),

  generationOpsEvents: defineTable({
    generationId: v.id("generations"),
    userId: v.id("users"),
    userEmail: v.optional(v.string()),
    eventType: generationOpsEventTypeValidator,
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

  opsAlertEvents: defineTable({
    alertType: v.union(
      v.literal("signup_alert"),
      v.literal("purchase_alert"),
      v.literal("secret_rotation_reminder"),
      v.literal("email_delivery_alert"),
    ),
    outcome: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_alertType_createdAt", ["alertType", "createdAt"]),

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

  generationFeedback: defineTable({
    userId: v.id("users"),
    generationId: v.id("generations"),
    rating: v.union(v.literal("up"), v.literal("down")),
    createdAt: v.number(),
  })
    .index("by_generation", ["generationId"])
    .index("by_user", ["userId", "createdAt"]),

  emailEvents: defineTable({
    userId: v.id("users"),
    emailType: v.literal("welcome"),
    scenario: v.optional(v.string()),
    recipientEmail: v.string(),
    componentEmailId: v.optional(v.string()),
    outcome: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_component_email_id", ["componentEmailId"])
    .index("by_createdAt", ["createdAt"]),
});
