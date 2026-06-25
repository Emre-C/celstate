# Audit 01: Deduplicate and Consolidate Code (DRY)

**Date:** 2026-06-24  
**Scope:** `src/`, `scripts/`, `packages/`  
**Tools:** `jscpd`, manual code search

---

## Summary

The codebase is in good shape overall — jscpd reports only 1.41% duplication (259 duplicated lines across 29 clones). However, several structural duplications exist that increase maintenance burden and risk drift.

---

## Findings

### 1. Repeated prompt validation logic (3 copies)

**Files:**
- `src/convex/generations.ts:268-292` (`requestGeneration`)
- `src/convex/generations.ts:322-331` (`requestGenerationForCanaryRunner`)
- `src/convex/generations.ts:1195-1206` (`requestGenerationForMcp`)

All three perform the same trim/empty-check/max-length validation on `prompt` with identical `ConvexError` messages. The canary runner also duplicates the aspect ratio validation.

**Recommendation:** Extract a `validatePromptInput(prompt: string): string` helper and a `validateAspectRatioInput(value: string): string` helper into a shared module (e.g. `src/convex/lib/generation/validation.ts`). All three call sites should call these instead of inlining the logic.

### 2. Webhook send-and-log pattern duplicated 4 times

**Files:**
- `src/convex/ops.ts:123-158` (`sendGenerationAlert`)
- `src/convex/ops.ts:180-196` (`sendSecretRotationReminder`)
- `src/convex/ops.ts:244-262` (`sendSignupAlert`)
- `src/convex/http.ts:339-358` (purchase alert in `handleCreditPackSettlement`)

All four follow the same pattern: build request → `fetch` → `assertOkWebhookResponse` → catch-and-log/console.error.

**Recommendation:** Extract a `sendOpsWebhook(config, context, buildRequest)` helper that encapsulates the fetch/assert/catch-log pattern. Each call site provides its `buildXxxRequest` function and context. This also standardizes error handling (some log to console, some record to DB, some do both).

### 3. Purge pattern duplicated between retention and QA reset

**Files:**
- `src/convex/generationArtifactRetention.ts:34-49` vs `src/convex/qaUserReset.ts:33-48`
- `src/convex/generationArtifactRetention.ts:73-81` vs `src/convex/qaUserReset.ts:70-78`
- `src/convex/generationArtifactRetention.ts:105-113` vs `src/convex/qaUserReset.ts:100-108`

Both files iterate child tables (generations, animationGenerations, lottieGenerations, mcpApiKeys, creditGrants, pendingCheckouts, etc.) keyed by `userId` and delete or repoint rows. The table list and iteration pattern is identical.

**Recommendation:** Extract a shared `forEachUserOwnedRecord(ctx, userId, callback)` helper that encapsulates the table list and iteration. Both retention purge and QA reset call it with their specific action (delete vs repoint).

### 4. Ops event type validator duplicated between schema and ops.ts

**Files:**
- `src/convex/schema.ts:165-174` (inline `v.union` of event type literals)
- `src/convex/ops.ts:268-281` (`recentOpsEventValidator` — same literals)
- `src/convex/lib/ops.ts:4-13` (`GENERATION_OPS_EVENT_TYPES` const array)

The same 8 event type literals are defined in three places. The schema inlines them instead of importing from validators.ts.

**Recommendation:** Export a `generationOpsEventTypeValidator` from `validators.ts` (derived from the `GENERATION_OPS_EVENT_TYPES` const in `ops.ts`), and use it in both `schema.ts` and `ops.ts`.

### 5. `formatRelativeTime` duplicated in two Svelte components

**Files:**
- `src/lib/components/ApiKeyDialog.svelte:158-167`
- `src/lib/components/GenerationCard.svelte` (similar time-ago logic)

**Recommendation:** Move to `src/lib/utils/format.ts` alongside the existing `formatTimeAgo` function. Check if the existing `formatTimeAgo` already covers this — if so, replace both usages.

### 6. HTTP route handler pattern duplicated in `http.ts`

**Files:**
- `src/convex/http.ts:173-182` vs `192-201` vs `250-256` vs `266-275`

Multiple Stripe webhook route registrations follow the same pattern: `httpAction` → `rawBody` check → `stripe.webhooks.constructEvent` → route to handler → error response.

**Recommendation:** Extract a `createStripeWebhookHandler(stripeSecret, handler)` factory that encapsulates the signature verification and error handling. Each route provides only its specific handler logic.

### 7. `normalizeError` / `normalizeGenerationError` / `getErrorMessage` — 3 variants

**Files:**
- `src/convex/lottieGeneration.ts:38-39` (`normalizeGenerationError`)
- `src/convex/mcp/toolResults.ts:16-19` (`getErrorMessage`)
- `src/routes/(app)/app/animations/+page.svelte:40-42` (`normalizeError`)
- `src/lib/auth/protected-session.ts:130-133` (`normalizeUserSyncErrorMessage`)

All extract a string from `unknown` error values with slightly different fallback strings.

**Recommendation:** Extract a single `getErrorMessage(error: unknown, fallback?: string): string` utility in `src/lib/utils/errors.ts`. Each call site can pass its domain-specific fallback. The protected-session variant has additional string-trim logic that can be composed on top.

---

## Critical Assessment

The duplications are not severe — the codebase is well-organized with most logic in single files. The highest-risk duplications are:

1. **Prompt validation** (3 copies) — any change to validation rules requires updating 3 places
2. **Child-table iteration** (2 copies) — adding a new user-owned table requires updating 2 places, and missing one creates orphaned rows
3. **Ops event types** (3 definitions) — adding a new event type requires updating 3 places

The webhook pattern duplication is lower risk since each handler has slightly different error handling semantics, but consolidating would improve consistency.

---

## Implementation Priority

| Priority | Item | Risk if not fixed |
|----------|------|-------------------|
| High | Prompt validation (3 copies) | Validation drift between public/canary/MCP paths |
| High | Child-table iteration (2 copies) | Orphaned rows on new tables |
| Medium | Ops event types (3 definitions) | Schema/validator drift |
| Medium | Webhook send pattern (4 copies) | Inconsistent error handling |
| Low | formatRelativeTime (2 copies) | Cosmetic |
| Low | normalizeError variants (4 copies) | Cosmetic |
| Low | HTTP route handler pattern | Cosmetic |
