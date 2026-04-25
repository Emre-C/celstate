# Weekly Credit Drip

## Overview

Celstate replenishes free-tier credits once per week with a paginated Convex job chain.

- Schedule: Monday at 14:00 UTC.
- Entry point: `src/convex/crons.ts` schedules `internal.users.grantWeeklyCredit`.
- Credit policy: users are topped up to `GENERATION_CONFIG.weeklyDripCap` rather than granted credits unconditionally.
- Audit trail: every actual grant inserts a `creditGrants` row with `reason: "weekly_drip"`.

This is the shipped implementation. The older single-mutation full-table scan is no longer used.

## Behavior

When the weekly cron runs:

1. `grantWeeklyCredit` starts the drip pass.
2. It calls `grantWeeklyCreditBatch`, which reads one page of users at a time.
3. For each user in that page, if `credits < weeklyDripCap`, the job:
   - sets `users.credits` to the cap;
   - inserts a `creditGrants` audit row for the granted amount.
4. If more users remain, the action self-schedules the next batch immediately with the returned pagination cursor.
5. The chain stops once Convex reports `isDone: true`.

The current implementation uses a fixed page size of `100` users per batch.

## Why It Works At Scale

The weekly drip no longer depends on a single mutation scanning the whole `users` table.

- User records are paginated with Convex's built-in cursor pagination.
- Each batch does bounded work and returns pagination state for the next run.
- The scheduler chain keeps per-mutation read/write volume predictable as the user base grows.

## Code References

- `src/convex/crons.ts` — weekly cron registration.
- `src/convex/users.ts` — `grantWeeklyCredit` action and `grantWeeklyCreditBatch` mutation.
- `src/convex/lib/config.ts` — `GENERATION_CONFIG.weeklyDripCap`.
- `src/convex/schema.ts` and `src/convex/creditGrants.ts` — audit storage and related credit-grant flows.

## Operational Notes

- The drip is a cap reset, not a stackable weekly bonus. A user already at or above the cap is unchanged.
- The mutation returns `{ continueCursor, isDone, processed }` so the action can continue the chain without holding the full run in one transaction.
- Because grants only happen when a user is below the cap, retrying a batch is naturally safe for already-topped-up users.
