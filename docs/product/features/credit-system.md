# Credit System

## Overview

Celstate uses a credit-based payment system. Users purchase credits to generate images. No subscriptions, no tiers — just pay-per-generation.

## Credit Flow

### 1. Initial Credits (New Users)

When a new user signs up via Google OAuth:
1. Convex Auth creates the user record
2. `afterUserCreatedOrUpdated` callback triggers
3. Initial credits seeded to user account

```typescript
// src/convex/lib/config.ts
initialCredits: 3,
```

New users receive 3 free credits to try the product.

### 2. Credit Deduction (Generation)

When user requests a generation:

```typescript
// src/convex/generations.ts - requestGeneration mutation
const user = await ctx.db.get(userId);
if (!user || (user.credits ?? 0) < creditsCost) {
  throw new Error("Insufficient credits");
}
await ctx.db.patch(userId, {
  credits: (user.credits ?? 0) - creditsCost,
});
```

- **Atomic operation**: Check + deduct in single mutation
- **Prevents double-spend**: Second concurrent request fails credit check

### 3. Credit Cost

```typescript
// src/convex/lib/config.ts
creditsPerGeneration: 1,
```

Each generation costs 1 credit.

### 4. Credit Refund (Failure)

If generation fails at any step:

```typescript
// src/convex/generation.ts - generateWorker handler
catch (e) {
  await ctx.runMutation(internal.generations.refundCredits, {
    userId: generation.userId,
    amount: generation.creditsCost,
  });
  await ctx.runMutation(internal.generations.failGeneration, {
    generationId: args.generationId,
    error: errorMessage,
  });
}
```

Refund triggers on:
- Gemini API errors
- Validation failures after max retries
- Dimension mismatch (aspect ratio differs fundamentally)
- Action timeout (5+ minutes)

### 5. Stale Generation Cleanup

Scheduled cron marks stale generations as failed and refunds credits:

```typescript
// src/convex/generations.ts - cleanupStaleGenerations
const staleThreshold = Date.now() - 5 * 60 * 1000; // 5 minutes
const stale = await ctx.db
  .query("generations")
  .withIndex("by_status", (q) => q.eq("status", "generating"))
  .collect();

for (const gen of stale) {
  if (gen.createdAt < staleThreshold) {
    await ctx.db.patch(gen._id, {
      status: "failed",
      error: "Generation timed out after 5 minutes",
    });
    // Refund credits
    const user = await ctx.db.get(gen.userId);
    if (user) {
      await ctx.db.patch(user.userId, {
        credits: (user.credits ?? 0) + gen.creditsCost,
      });
    }
  }
}
```

## Schema

```typescript
// src/convex/schema.ts
users: defineTable({
  // ... auth fields
  credits: v.optional(v.number()),
}),

generations: defineTable({
  userId: v.id("users"),
  creditsCost: v.number(),
  // ...
}),
```

## UI Display

Credit balance shown in app navigation bar:

```svelte
<!-- src/routes/(app)/app/+layout.svelte -->
<span class="font-mono text-xs tracking-widest text-accent">
  {credits} credits
</span>
```

## Future: Credit Purchase

Per VISION.md, credit purchase via Stripe is planned but not yet implemented:
- Credits purchased in $10 increments
- Credits do not expire
- Purchase flow via direct Stripe integration
