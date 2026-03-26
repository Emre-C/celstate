import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server.js";
import { creditGrantReasonValidator } from "./lib/validators.js";
import { applyCreditsToUser } from "./users.js";

export const getByPaymentIntentId = internalQuery({
  args: { stripePaymentIntentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("creditGrants")
      .withIndex("by_payment_intent", (q) => q.eq("stripePaymentIntentId", args.stripePaymentIntentId))
      .first();
  },
});

export const recordGrant = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    reason: creditGrantReasonValidator,
    stripePaymentIntentId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    // Idempotency guard: if a grant for this payment intent already exists, skip
    if (args.stripePaymentIntentId) {
      const existing = await ctx.db
        .query("creditGrants")
        .withIndex("by_payment_intent", (q) => q.eq("stripePaymentIntentId", args.stripePaymentIntentId))
        .first();
      if (existing) {
        return false;
      }
    }

    const applied = await applyCreditsToUser(ctx, args.userId, args.amount);
    if (!applied) {
      return false;
    }

    // Insert audit record
    await ctx.db.insert("creditGrants", {
      userId: args.userId,
      amount: args.amount,
      reason: args.reason,
      stripePaymentIntentId: args.stripePaymentIntentId,
      createdAt: Date.now(),
    });

    return true;
  },
});
