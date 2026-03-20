import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    credits: v.optional(v.number()),
    stripeCustomerId: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("by_token", ["tokenIdentifier"]),

  generations: defineTable({
    userId: v.id("users"),
    prompt: v.string(),
    status: v.union(
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed")
    ),
    stage: v.optional(v.union(
      v.literal("white_background"),
      v.literal("black_background"),
      v.literal("finalizing")
    )),
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
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    generationTimeMs: v.optional(v.number()),
    retryCount: v.optional(v.number()),
    whiteBgRetryCount: v.optional(v.number()),
    blackBgRetryCount: v.optional(v.number()),
    finalizeRetryCount: v.optional(v.number()),
    dimensionMismatch: v.optional(v.boolean()),
    creditRefundedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_status", ["status"]),

  creditGrants: defineTable({
    userId: v.id("users"),
    amount: v.number(),
    reason: v.union(
      v.literal("signup_bonus"),
      v.literal("weekly_drip"),
      v.literal("purchase"),
      v.literal("admin_grant"),
    ),
    stripePaymentIntentId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_user", ["userId", "createdAt"]),

  pendingCheckouts: defineTable({
    userId: v.id("users"),
    priceId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("failed")
    ),
    checkoutUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_user_status", ["userId", "status"]),
});
