# Weekly Credit Grant — Scaling Plan

## Current Implementation

**File:** `src/convex/users.ts` → `grantWeeklyCredit`
**Schedule:** `src/convex/crons.ts` → weekly, Monday 14:00 UTC

The current implementation queries all users in a single Convex mutation and grants credits to those below the weekly drip cap. This works fine at small scale but will hit limits as the user base grows.

### Why It Won't Scale

1. **Convex mutation time limits:** A single mutation that reads and writes thousands of user records will eventually exceed Convex's execution time budget.
2. **Memory pressure:** `.collect()` loads every user document into memory at once.
3. **Write amplification:** Each eligible user requires a `patch` (user credits) and an `insert` (creditGrants audit row) — at 10k users this is up to 20k write operations in one transaction.

## Recommended Approach: Paginated Scheduler Chain

Replace the single mutation with a self-scheduling chain that processes users in fixed-size batches.

### Design

```
grantWeeklyCreditBatch(cursor?: Id<"users">, batchSize: number)
  1. Query `users` starting after `cursor`, take `batchSize` (e.g. 100)
  2. For each user below the drip cap:
     - Patch credits
     - Insert creditGrants row
  3. If batch was full (more users remain):
     - scheduler.runAfter(0, internal.users.grantWeeklyCreditBatch, { cursor: lastUserId, batchSize })
  4. Otherwise, done.
```

### Changes Required

1. **Add a new `internalMutation`** — `grantWeeklyCreditBatch` with args:
   - `cursor: v.optional(v.id("users"))` — resume point
   - `batchSize: v.optional(v.number())` — defaults to 100

2. **Update the cron** in `src/convex/crons.ts` to call `grantWeeklyCreditBatch` instead of `grantWeeklyCredit`.

3. **Keep the old `grantWeeklyCredit`** temporarily for backward compatibility, but mark it as deprecated.

4. **Add a `by_id` or natural ordering query** — Convex tables are naturally ordered by `_id`, so paginating with `filter(q => q.gt(q.field("_id"), cursor))` works without an extra index.

### Batch Size Considerations

- **100 users per batch** is conservative and safe within Convex mutation limits.
- Each batch does at most 200 writes (100 patches + 100 inserts).
- At 10,000 users, this produces ~100 scheduled mutations that execute sequentially within seconds.
- At 100,000 users, ~1,000 mutations — still well within Convex's scheduler capacity.

### Idempotency

The current implementation is naturally idempotent (it only grants if credits < cap), so re-running a batch on the same users is safe. No additional deduplication is needed.

### Observability

Consider adding a summary log at the end of the chain:
- Total users processed
- Total grants issued
- Total execution time across all batches

This can be done by passing accumulator args through the chain or by querying `creditGrants` after completion.

### When to Implement

This becomes necessary when the user count exceeds ~500–1,000 users, or if you observe the weekly cron timing out or producing errors in the Convex dashboard. Until then, the current single-mutation approach is adequate.
