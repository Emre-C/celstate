import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

export const save = mutation({
  args: {
    jobId: v.string(),
    role: v.string(),
    filename: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    bytes: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("jobs")
      .withIndex("by_job_id", (q) => q.eq("jobId", args.jobId))
      .unique();

    if (!job) {
      throw new Error(`Job not found: ${args.jobId}`);
    }

    const existing = await ctx.db
      .query("jobAssets")
      .withIndex("by_job_role", (q) =>
        q.eq("jobId", args.jobId).eq("role", args.role)
      )
      .unique();

    const payload = {
      jobId: args.jobId,
      role: args.role,
      filename: args.filename,
      storageId: args.storageId,
      contentType: args.contentType,
      bytes: args.bytes,
      createdAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return await ctx.db.insert("jobAssets", payload);
  },
});
