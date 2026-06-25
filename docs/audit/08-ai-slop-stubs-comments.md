# Audit 08: Remove AI Slop, Stubs, and Unnecessary Comments

**Date:** 2026-06-24  
**Scope:** `src/`  
**Tools:** grep, manual code review

---

## Summary

The codebase is remarkably clean of AI slop — no stubs, no placeholder code, no larp patterns. However, there are verbose comments that describe historical context, migration narratives, and in-motion work that should be trimmed or rewritten for clarity.

---

## Findings

### 1. No stubs or placeholder code

Grep for `stub`, `placeholder`, `temporary`, `TODO`, `FIXME`, `HACK`, `WORKAROUND` across `src/` found zero matches in actual code. The only `TODO`-like patterns are in test assertions and comments about test scenarios, which are legitimate.

**Verdict:** Clean. No action needed.

### 2. Historical narrative comments — should be trimmed

These comments describe past events, migrations, or bugs that are no longer in motion. They add noise for a new reader trying to understand the code.

#### 2a. WorkOS→Clerk cutover narrative

`src/convex/users.ts:64-70`:
```
/**
 * Finds every existing row a given identity could map to. A single Clerk sign-in
 * can match more than one row during the WorkOS→Clerk cutover: a legacy account
 * keyed by email/token, plus a `clerkUserId`-only shell created on first Clerk
 * sign-in. Email matching requires a *verified* email (never `emailVerified === false`)
 * so an unverified identity cannot take over an established account.
 */
```

**Recommendation:** Trim to: "Resolves all user rows matching a given identity (clerkUserId, token, verified email). Returns oldest-first; the oldest row is canonical."

#### 2b. "The historical bug" comment

`src/lib/auth/protected-session.ts:70-78`:
```
// User-sync retry policy lives here so the route adapter cannot accidentally drop a
// failed bootstrap on the floor (the historical bug: a transient mutation rejection
// would leave `startedUserSync = true` with no recovery path until a full reload).
//
// Bounded auto-retry with exponential backoff prevents a stuck account screen for
// transient Convex-side failures (cold function start, brief network hiccup, etc.)
// while still surfacing a manual recovery affordance once the budget is exhausted
// — at which point the failure is more likely structural and warrants user action.
```

**Recommendation:** Trim to: "Bounded retry with exponential backoff for user-sync. Prevents stuck account screen on transient failures; surfaces manual recovery after budget exhaustion."

#### 2c. Clerk flush appearance comment

`src/routes/auth/+page.svelte:21-24`:
```
// Clerk's official "flush" elevation (May 2026) removes card background,
// border, and shadow so the widget embeds into the page surface. We then
// style internal elements to match the Celstate design system.
// Docs: https://clerk.com/changelog/2026-05-22-flush-appearance-option
```

**Recommendation:** Keep the docs link, trim the narrative. Replace with: "Clerk 'flush' elevation embeds the widget without card chrome. Component-scoped appearance overrides below match the Celstate design system."

#### 2d. Convex `setupAuth` SSR comment

`src/routes/(app)/+layout.svelte:36-38`:
```
// Convex `setupAuth` needs a one-shot SSR snapshot; not a reactive binding.
// svelte-ignore state_referenced_locally
```

**Verdict:** This is a necessary Svelte compiler directive explanation. Keep as-is.

#### 2e. Set-Cookie preservation comment

`src/lib/server/response.ts:4-6`:
```
// Preserve Set-Cookie headers explicitly because new Headers()
// from another Headers object can comma-join them, which breaks
// cookie clearing on sign-out and other auth boundaries.
```

**Verdict:** This explains a non-obvious API behavior. Keep as-is — it's helpful for a new reader.

#### 2f. Schema comments referencing legacy

`src/convex/schema.ts:38`:
```
/** Legacy WorkOS subject — retained until prod rows are backfilled or re-bound via Clerk sign-in. */
```

`src/convex/schema.ts:99-100`:
```
// Retired animation history. Retained only so old rows can be merged, reset,
// and purged safely; do not add new request surfaces against this table.
```

**Recommendation:** These are accurate and useful — they tell a new reader why deprecated fields exist. Keep until the fields are removed (see Audit 07), then delete.

### 3. Section markers in production-confidence types

`src/lib/production-confidence/types.ts` — extensive `// --- §5.1 Domain vocabulary` style section markers throughout.

**Verdict:** These reference a spec document (`docs/product/production-confidence.md`). They're useful for cross-referencing but verbose. Acceptable as-is for a spec-driven module.

### 4. Comment about Convex Headers API

`src/convex/mcp/handler.ts:83`:
```
// Use forEach: Convex's deploy-time `tsc` lib for `Headers` may omit `entries()`.
```

**Verdict:** This is a platform-specific workaround explanation. Keep — it prevents a future developer from "cleaning up" to `entries()` and breaking Convex deploys.

### 5. Email claim warning in `upsertCurrentUser`

`src/convex/users.ts:334-345`:
```
// The `email` claim is the only key that links a Clerk sign-in back to an
// established account (legacy WorkOS rows, or a cutover shell). If it is
// absent the Convex JWT template is missing the `email` claim — without it
// account adoption/merge silently cannot run and the user is stranded on a
// clerkUserId-only shell. Surface it loudly in Convex logs.
```

**Recommendation:** Trim to: "Email claim is required for account linking. If absent, the Clerk JWT template is misconfigured." The console.warn below already has the detailed message.

### 6. Processing lease comment block

`src/convex/schema.ts:215-221`:
```
// Processing lease for the action that creates the Stripe Checkout
// Session. Set atomically by `claimCheckoutForProcessing`. A non-null
// value within the lease TTL means a `processCheckout` invocation is
// mid-flight and any concurrent replay must skip the Stripe side
// effect. `processingLeaseId` binds terminal transitions to the owner
// that acquired the lease, so an action whose lease was later reclaimed
// cannot mark the newer owner failed/ready.
```

**Recommendation:** Trim to: "Processing lease for Stripe Checkout creation. `claimCheckoutForProcessing` acquires; terminal transitions require lease ownership." The full concurrency reasoning is in the function docs.

### 7. `mergeUserInto` JSDoc

`src/convex/users.ts:132-143`:
```
/**
 * Repoints a duplicate user's owned records onto the canonical row, copies over
 * any account state the canonical row is missing (billing, profile), and deletes
 * the duplicate. Used to consolidate a WorkOS→Clerk cutover shell into the
 * established account. The child-table list mirrors `qaUserReset` — every table
 * keyed by `userId` must be repointed or the rows would be orphaned.
 *
 * Credits are intentionally NOT summed: the canonical (older) row keeps its own
 * balance, and the duplicate's default sign-up grant is discarded to avoid
 * double-granting. Purchased balance is preserved because real purchases live on
 * the canonical account that predates any shell.
 */
```

**Recommendation:** Trim to: "Consolidates a duplicate user row into the canonical one: repoints child-table records, backfills missing profile/billing fields, deletes the duplicate. Credits are not summed to avoid double-granting." The WorkOS→Clerk context will be irrelevant once the cutover is complete.

### 8. `formatRelativeTime` + `formatCalendarTime` in ApiKeyDialog

`src/lib/components/ApiKeyDialog.svelte:158-175` — two time formatting functions defined inline.

**Verdict:** Not comments, but these are utility functions that should be in `src/lib/utils/format.ts` (see Audit 01). Not AI slop.

---

## Critical Assessment

The codebase has no AI slop — no stubs, no placeholder code, no larp patterns, no TODO/FIXME markers. The comment quality is generally high, with most comments explaining non-obvious behavior or platform quirks.

The main issue is **historical narrative verbosity** — several comments tell the story of past migrations, bugs, or decisions that are no longer in motion. These are noise for a new reader who needs to understand the current code, not the history. The principle: comments should explain *what the code does and why*, not *what happened before*.

---

## Implementation Priority

| Priority | Item | Action |
|----------|------|--------|
| Medium | Trim WorkOS→Clerk cutover narrative comments | Rewrite to describe current behavior |
| Medium | Trim "historical bug" comment in protected-session | Focus on current behavior |
| Medium | Trim email claim warning in upsertCurrentUser | Keep the console.warn, trim the comment |
| Medium | Trim processing lease comment block | Focus on current contract |
| Low | Trim Clerk flush appearance comment | Keep docs link, trim narrative |
| Low | Trim `mergeUserInto` JSDoc | Remove cutover context |
| None | Schema legacy comments | Keep until fields removed (Audit 07) |
| None | Platform workaround comments | Keep — prevent regression |
| None | Spec section markers | Keep — useful for cross-reference |
