import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";
import { verificationRunValidator, verificationTriggerValidator } from "./lib/validators.js";
import { assertVerificationRunnerSecret } from "./lib/verificationRunnerSecret.js";

/** Fetch a verification run by its stable run key. */
export const getRunByKey = internalQuery({
  args: {
    runnerSecret: v.string(),
    runKey: v.string(),
  },
  returns: v.union(verificationRunValidator, v.null()),
  handler: async (ctx, args) => {
    assertVerificationRunnerSecret(args.runnerSecret);
    return await ctx.db
      .query("verificationRuns")
      .withIndex("by_run_key", (q) => q.eq("runKey", args.runKey))
      .first();
  },
});

/**
 * Returns the most recent completed run for a given deploymentId and trigger.
 * Uses the `by_deployment_trigger_startedAt` index for O(log n) lookup.
 */
export const getLatestRunByDeployment = internalQuery({
  args: {
    runnerSecret: v.string(),
    deploymentId: v.string(),
    trigger: verificationTriggerValidator,
  },
  returns: v.union(verificationRunValidator, v.null()),
  handler: async (ctx, args) => {
    assertVerificationRunnerSecret(args.runnerSecret);
    return await ctx.db
      .query("verificationRuns")
      .withIndex("by_deployment_trigger_startedAt", (q) =>
        q.eq("deploymentId", args.deploymentId).eq("trigger", args.trigger),
      )
      .order("desc")
      .first();
  },
});
