# Remaining deduplication & Convex quality work

This document tracks **follow-up work** after the preventive tooling and refactors described in [hardening.md](./hardening.md). It complements the audit context in [CODE-CLEAN.md](./CODE-CLEAN.md).

## Background

We added **jscpd** (duplicate detection) to CI with a **baseline threshold** so the gate blocks *new* copy-paste without requiring a single giant cleanup. We then **deduplicated** several hotspots:

- Shared Convex value validators (`src/convex/lib/validators.ts`) for pipeline stages and credit-grant reasons.
- A single insert path for `generationOpsEvents` (`src/convex/lib/generationOpsEvents.ts`).
- Shared webhook response handling (`assertOkWebhookResponse` in `src/convex/lib/ops.ts`).
- Consolidated alert payload fields and shared generation action `args` in `ops.ts` / `generation.ts`.

**Current state:** Duplicated lines are roughly **~2%** of analyzed Convex TypeScript (per `pnpm dupcheck`), down from earlier baselines. **Ten** clone groups still report in jscpd—mostly *structural* repetition, not forgotten helpers.

## Why finish the remaining work

| Reason | Explanation |
|--------|-------------|
| **Change cost** | Repeated blocks mean every behavior or policy change must be applied in multiple places—easy to miss one and ship inconsistent behavior (alerts, stages, refunds). |
| **Review load** | Reviewers must diff near-identical hunks repeatedly instead of validating one abstraction. |
| **Threshold headroom** | CI allows up to the configured jscpd `threshold`. Reducing intrinsic duplication **tightens that ceiling** over time so new copy-paste fails faster. |
| **Onboarding** | New contributors map the pipeline faster when stage transitions and API shapes have a single obvious source of truth. |

This is **not** about chasing 0% duplication (often impossible or harmful with validators and schema). It is about removing *avoidable* repetition where the tradeoffs are acceptable.

---

## Remaining items (ordered by impact)

### 1. `generations.getById` return validator vs `schema.ts`

**What:** The internal query `getById` in `src/convex/generations.ts` declares a large `returns: v.object({ ... })` that **mirrors** the `generations` table shape in `src/convex/schema.ts`.

**Why it matters:** Any new field on `generations` requires updating two places; drift causes runtime validation errors or false negatives.

**Next steps:**

1. Prefer **one of**:
   - **Loosen** the return validator (e.g. `returns: v.any()` or a minimal subset of fields the action truly needs) *only where* internal callers are trusted and you accept less strict API documentation; or
   - **Generate** or **compose** validators from shared building blocks (e.g. split `generations` field groups into named `v` fragments in `lib/validators.ts` and reuse in both schema and `returns`).
2. Add a short comment above `getById` explaining the contract (who calls it, which fields are required).
3. Re-run `pnpm dupcheck` and tighten `.jscpd.json` `threshold` slightly if duplication drops.

---

### 2. Stage success handlers (`recordWhiteBackgroundSuccess`, `recordBlackBackgroundSuccess`, adjacent flows)

**What:** Mutations that advance the pipeline (patch row, insert ops event, schedule next stage) follow the **same narrative** with different literals.

**Why it matters:** Bug fixes (e.g. retry counts, `lastProgressAt`, event payloads) have been applied consistently so far, but the symmetry is manual.

**Next steps:**

1. Extract a **single internal helper** (e.g. `advanceGenerationStage`) that takes `fromStage`, `toStage`, patch payload, and ops-event metadata—*only if* the team is comfortable with slightly more indirection in Convex mutations.
2. Keep mutations as thin wrappers that call the helper so `internal.*` API names stay stable.
3. Add focused tests (existing Vitest / Convex patterns) for one happy path per transition.

---

### 3. `scheduleStageRetry` vs `markStageAttemptStarted`

**What:** Overlapping structure (load generation, guard status, patch, optional `insertGenerationOpsEventRow`).

**Why it matters:** Retry and “attempt started” semantics are security- and billing-sensitive; duplication increases the risk of diverging guards.

**Next steps:**

1. Document **invariants** in a comment block (e.g. “must only run while `status === 'generating'`”).
2. Factor shared **read-guard-patch** into a private function in `generations.ts` *if* it does not worsen TOCTOU clarity (see [Convex conventions](../conventions/convex.md)).
3. Re-run tests and `pnpm verify` (includes Playwright E2E when the full gate runs).

---

### 4. Ops alert `args` block vs schema field list

**What:** jscpd still sees similarity between `recordAlertEvent` / `sendGenerationAlert` **args** and `generationOpsEvents` **columns** in the schema—by design, they describe the same row.

**Why it matters:** Low—mostly **structural** coupling. The real risk is adding a column and forgetting to thread it through the action.

**Next steps:**

1. When adding fields, use a **checklist**: schema → `insertGenerationOpsEventRow` / `GenerationOpsEventInsert` → `recordAlertEvent` args → `sendGenerationAlert` → `buildGenerationAlertRequest`.
2. Optional: add a **type** that extends `GenerationOpsEventInsert` for alert-specific calls to force compile-time alignment (may require small refactors).

---

### 5. Stale-generation cleanup vs other `insertGenerationOpsEventRow` call sites

**What:** The stall path in `cleanupStaleGenerations` builds a similar ops-event payload to other call sites.

**Why it matters:** Stall alerts and refunds are user-visible; field mistakes affect analytics and support.

**Next steps:**

1. Consider a tiny helper `recordStallEvent(ctx, gen, now)` if it stays readable.
2. Ensure stall/fail ordering matches product policy (document in code or product doc).

---

### 6. Further jscpd threshold tightening

**What:** `.jscpd.json` sets a maximum **duplicated lines** percentage; it was lowered as duplication dropped.

**Why it matters:** A looser threshold allows gradual regression; a tighter one forces discipline.

**Next steps:**

1. After each substantive dedupe PR, run `pnpm dupcheck`, note the new **Total** duplicated lines %, and lower `threshold` toward that value **plus a small buffer** (e.g. +0.5%).
2. Record the buffer rationale in a PR description so future changes do not silently widen the gate.

---

## How to use this doc

- **Planning:** Pick one numbered section per PR; avoid mixing unrelated refactors.
- **Definition of done:** `pnpm verify` green (including `pnpm test:e2e` in that flow); `pnpm dupcheck` still green; behavior unchanged or explicitly approved (product/testing).
- **Related reading:** [hardening.md](./hardening.md), [Convex conventions](../conventions/convex.md), [CODE-CLEAN.md](./CODE-CLEAN.md).
