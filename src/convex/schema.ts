import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  users: defineTable({
    // Auth fields (from authTables)
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // Custom fields
    credits: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  generations: defineTable({
    userId: v.id("users"),
    prompt: v.string(),
    status: v.union(
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed")
    ),
    resultStorageId: v.optional(v.id("_storage")),
    whiteBgStorageId: v.optional(v.id("_storage")),
    blackBgStorageId: v.optional(v.id("_storage")),
    creditsCost: v.number(),
    aspectRatio: v.string(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    generationTimeMs: v.optional(v.number()),
    retryCount: v.optional(v.number()),
    dimensionMismatch: v.optional(v.boolean()),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_status", ["status"]),
});
