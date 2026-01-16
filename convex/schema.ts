import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  jobs: defineTable({
    jobId: v.string(),
    status: v.string(),
    progressStage: v.string(),
    prompt: v.string(),
    styleContext: v.string(),
    name: v.string(),
    layoutIntent: v.string(),
    renderSizeHint: v.optional(v.number()),
    internalAssetType: v.string(),
    ownerId: v.optional(v.id("users")),
    component: v.optional(v.any()),
    telemetry: v.optional(v.any()),
    error: v.optional(v.string()),
    retryAfter: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job_id", ["jobId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"]),

  jobAssets: defineTable({
    jobId: v.string(),
    role: v.string(),
    filename: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    bytes: v.number(),
    ownerId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_owner", ["ownerId"])
    .index("by_job_role", ["jobId", "role"]),

  jobEvents: defineTable({
    jobId: v.string(),
    kind: v.string(),
    payload: v.any(),
    ownerId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_owner", ["ownerId"]),
});
