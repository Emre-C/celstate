import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";
import { domainVerdictRecordValidator, verificationTriggerValidator } from "./lib/validators.js";
import { assertVerificationRunnerSecret } from "./lib/verificationRunnerSecret.js";

const verificationRunValidator = v.object({
  _id: v.id("verificationRuns"),
  _creationTime: v.number(),
  runKey: v.string(),
  trigger: verificationTriggerValidator,
  deploymentId: v.optional(v.string()),
  gitSha: v.optional(v.string()),
  siteUrl: v.optional(v.string()),
  workflowRunId: v.optional(v.string()),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  releaseDecision: v.optional(v.union(v.literal("ALLOW"), v.literal("DENY"))),
  requiredDomains: v.array(v.union(
    v.literal("AUTH"),
    v.literal("GENERATION"),
    v.literal("CHECKOUT_SESSION"),
    v.literal("LIVE_SETTLEMENT"),
  )),
  authVerdict: v.optional(domainVerdictRecordValidator),
  generationVerdict: v.optional(domainVerdictRecordValidator),
  checkoutSessionVerdict: v.optional(domainVerdictRecordValidator),
  liveSettlementVerdict: v.optional(domainVerdictRecordValidator),
});

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
