import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";

export const getByPaymentIntentId = internalQuery({
  args: { stripePaymentIntentId: v.string() },
  handler: async (ctx, args) => {
    const grants = await ctx.db
      .query("creditGrants")
      .filter((q) => q.eq(q.field("stripePaymentIntentId"), args.stripePaymentIntentId))
      .first();
    return grants;
  },
});

export const recordGrant = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    reason: v.union(
      v.literal("signup_bonus"),
      v.literal("weekly_drip"),
      v.literal("purchase"),
      v.literal("admin_grant"),
    ),
    stripePaymentIntentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Grant credits to user
    await ctx.runMutation(internal.users.addCreditsByUserId, {
      userId: args.userId,
      amount: args.amount,
    });

    // Insert audit record
    await ctx.db.insert("creditGrants", {
      userId: args.userId,
      amount: args.amount,
      reason: args.reason,
      stripePaymentIntentId: args.stripePaymentIntentId,
      createdAt: Date.now(),
    });
  },
});
