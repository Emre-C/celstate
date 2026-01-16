import { v } from "convex/values";
import { requireAuth, checkServiceKey } from "./lib/auth";
import { mutation, query } from "./_generated/server";

const JOB_ARGUMENTS = {
  jobId: v.string(),
  status: v.string(),
  progressStage: v.string(),
  prompt: v.string(),
  styleContext: v.string(),
  name: v.string(),
  layoutIntent: v.string(),
  renderSizeHint: v.optional(v.number()),
  internalAssetType: v.string(),
  component: v.optional(v.any()),
  telemetry: v.optional(v.any()),
  error: v.optional(v.string()),
  retryAfter: v.optional(v.number()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
};

export const upsert = mutation({
  args: {
    ...JOB_ARGUMENTS,
    serviceKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const isServiceRequest = checkServiceKey(args.serviceKey);
    const ownerId = isServiceRequest ? null : await requireAuth(ctx);
    const existing = await ctx.db
      .query("jobs")
      .withIndex("by_job_id", (q) => q.eq("jobId", args.jobId))
      .unique();

    const updatedAt = args.updatedAt ?? Date.now();
    const payload = {
      status: args.status,
      progressStage: args.progressStage,
      prompt: args.prompt,
      styleContext: args.styleContext,
      name: args.name,
      layoutIntent: args.layoutIntent,
      renderSizeHint: args.renderSizeHint,
      internalAssetType: args.internalAssetType,
      ownerId: ownerId ?? existing?.ownerId,
      component: args.component,
      telemetry: args.telemetry,
      error: args.error,
      retryAfter: args.retryAfter,
      updatedAt,
    };

    if (!payload.ownerId) {
      delete (payload as Partial<typeof payload>).ownerId;
    }

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    const createdAt = args.createdAt ?? Date.now();
    return await ctx.db.insert("jobs", {
      jobId: args.jobId,
      createdAt,
      ...payload,
    });
  },
});

export const listForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireAuth(ctx);
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();

    return jobs.map((job) => ({
      jobId: job.jobId,
      status: job.status,
      progressStage: job.progressStage,
      name: job.name,
      layoutIntent: job.layoutIntent,
      renderSizeHint: job.renderSizeHint ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }));
  },
});

export const getPublic = query({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("jobs")
      .withIndex("by_job_id", (q) => q.eq("jobId", args.jobId))
      .unique();

    if (!job) {
      return null;
    }

    const assets = await ctx.db
      .query("jobAssets")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    const assetUrls: Record<string, string | null> = {};
    for (const asset of assets) {
      assetUrls[asset.filename] = await ctx.storage.getUrl(asset.storageId);
    }

    let component = null;
    if (job.component) {
      const baseAssets =
        typeof job.component === "object" && job.component !== null
          ? { ...(job.component as { assets?: Record<string, string | null> }).assets }
          : {};
      component = {
        ...(job.component as Record<string, unknown>),
        assets: {
          ...baseAssets,
          ...assetUrls,
        },
      };
    }

    return {
      jobId: job.jobId,
      status: job.status,
      retryAfter: job.retryAfter,
      error: job.error,
      component,
    };
  },
});
