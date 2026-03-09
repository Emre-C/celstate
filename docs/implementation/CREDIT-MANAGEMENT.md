# Credit Management — Ad-hoc Operations

## 2026-03-08: Emergency Credit Grant

Added 10 credits to test user `emre.coklar@gmail.com` via internal mutation.

### What We Did

1. Added `addCredits` mutation to `src/convex/users.ts`:
   ```typescript
   export const addCredits = internalMutation({
     args: { email: v.string(), amount: v.number() },
     returns: v.boolean(),
     handler: async (ctx, args) => {
       const user = await ctx.db
         .query("users")
         .withIndex("email", (q) => q.eq("email", args.email))
         .first();
       if (!user) {
         return false;
       }
       await ctx.db.patch(user._id, {
         credits: (user.credits ?? 0) + args.amount,
       });
       return true;
     },
   });
   ```

2. Deployed with `npx convex dev --once`

3. Executed: `npx convex run users:addCredits '{"email": "emre.coklar@gmail.com", "amount": 10}'`

---

## Security Issues with Current Approach

### Problems

1. **No access control**: Any developer with Convex CLI access can add unlimited credits to any user
2. **No audit trail**: No record of who granted credits, when, or why
3. **No rate limiting**: Can be called repeatedly to grant infinite credits
4. **No authentication on mutation**: Internal mutations have no runtime auth check
5. **Convex CLI access = admin**: Anyone who can run `convex run` can modify production data

### Attack Surface

- Stolen Convex dev tokens
- Disgruntled team member
- Accidental bulk grants

---

## Future: Robust Credit Management

### Option A: Admin API with Auth

Create an authenticated admin endpoint:

```typescript
// src/convex/admin.ts
export const grantCredits = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    reason: v.string(), // "promotion", "support", "refund", etc.
  },
  handler: async (ctx, args) => {
    // Check admin role
    const admin = await ctx.auth.getUserIdentity();
    if (!admin || admin.tokenIdentifier !== "admin@example.com") {
      throw new Error("Admin access required");
    }
    
    // Record the grant
    await ctx.db.insert("creditGrants", {
      userId: args.userId,
      amount: args.amount,
      reason: args.reason,
      grantedBy: admin.subject,
      grantedAt: Date.now(),
    });
    
    // Add credits
    await ctx.db.patch(args.userId, {
      credits: (await ctx.db.get(args.userId)).credits + args.amount,
    });
  },
});
```

### Option B: Credit Grants Table (Audit Trail)

```typescript
// schema.ts
creditGrants: defineTable({
  userId: v.id("users"),
  amount: v.number(),
  reason: v.string(),
  grantedBy: v.string(), // admin email or system ("signup_bonus", "purchase")
  grantedAt: v.number(),
}).index("by_user", ["userId"]),
```

### Option C: Stripe Integration (Production)

Proper credit purchase flow per VISION.md:
- Stripe Checkout for credit purchases
- Webhook handler to verify payment and grant credits
- Automatic, audited, no manual intervention

---

## Recommended Path Forward

1. **Immediate**: Remove the `addCredits` mutation from the codebase (or keep it but don't document the command)

2. **Short-term**: Add audit trail (`creditGrants` table) + admin role check

3. **Medium-term**: Stripe integration for production credit purchases

4. **Long-term**: Full billing dashboard with history, analytics, and self-service

---

## How to Remove the Mutation

If you want to remove the quick hack:

```bash
# Remove the mutation from src/convex/users.ts
# Then redeploy
npx convex dev --once
```

Or simply don't commit the mutation changes if you revert the file.
