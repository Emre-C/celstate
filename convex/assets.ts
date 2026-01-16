import { v } from "convex/values";
import { checkServiceKey, requireAuth } from "./lib/auth";
import { mutation, query } from "./_generated/server";

export const generateUploadUrl = mutation({
  args: { serviceKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const isServiceRequest = checkServiceKey(args.serviceKey);
    if (!isServiceRequest) {
      await requireAuth(ctx);
    }
    return ctx.storage.generateUploadUrl();
  },
});

export const save = mutation({
  args: {
    jobId: v.string(),
    role: v.string(),
    filename: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    bytes: v.number(),
    serviceKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const isServiceRequest = checkServiceKey(args.serviceKey);
    const ownerId = isServiceRequest ? null : await requireAuth(ctx);
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
      ownerId: ownerId ?? existing?.ownerId,
      createdAt: Date.now(),
    };

    if (!payload.ownerId) {
      delete (payload as Partial<typeof payload>).ownerId;
    }

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return await ctx.db.insert("jobAssets", payload);
  },
});

export const listForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireAuth(ctx);
    const assets = await ctx.db
      .query("jobAssets")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();

    return await Promise.all(
      assets.map(async (asset) => ({
        jobId: asset.jobId,
        role: asset.role,
        filename: asset.filename,
        contentType: asset.contentType,
        bytes: asset.bytes,
        createdAt: asset.createdAt,
        url: await ctx.storage.getUrl(asset.storageId),
      }))
    );
  },
});
