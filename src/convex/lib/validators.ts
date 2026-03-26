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
