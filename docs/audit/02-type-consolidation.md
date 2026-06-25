# Audit 02: Consolidate Shared Type Definitions

**Date:** 2026-06-24  
**Scope:** `src/`, `scripts/`  
**Tools:** Manual code search, grep

---

## Summary

Several domain types are defined multiple times across different files with identical or near-identical shapes. This creates a maintenance risk where updates to one definition don't propagate to others.

---

## Findings

### 1. `GenerationStage` — defined 3 times

**Definitions:**
- `src/convex/lib/generation/generationRun.ts:6` — `Infer<typeof generationStageValidator>` (canonical, derived from Convex validator)
- `src/lib/ops/investigation.ts:11` — `type GenerationStage = 'white_background' | 'black_background' | 'finalizing'` (hardcoded string literals)
- `src/lib/analytics/generation.ts:10-16` — `GENERATION_FAILURE_STAGES` const + `GenerationFailureStage` type (same literals)

**Risk:** If a stage is added to the validator, the investigation and analytics types won't update. The investigation type is used in `OpsTimelineEvent` and `GenerationInvestigationReport` which are consumed by the ops CLI.

**Recommendation:** The canonical source should be the Convex validator in `validators.ts`. Export a TS type from there and import it in both `investigation.ts` and `analytics/generation.ts`. For the analytics file, `GenerationFailureStage` can be a type alias of the canonical `GenerationStage`.

### 2. `GenerationFailureKind` — defined 2 times

**Definitions:**
- `src/lib/ops/investigation.ts:13` — `type GenerationFailureKind = 'timeout' | 'provider_error' | 'processing_error' | 'unknown'`
- `src/lib/analytics/generation.ts:1-8` — `GENERATION_FAILURE_KINDS` const + `GenerationFailureKind` type (same values)

**Risk:** Adding a new failure kind requires updating both files.

**Recommendation:** Single source in `src/lib/analytics/generation.ts` (it has the const array + type + classifier). Import the type in `investigation.ts`.

### 3. `OpsEventType` / `GenerationOpsEventType` — defined 2 times

**Definitions:**
- `src/lib/ops/investigation.ts:17-25` — `OpsEventType` type union
- `src/convex/lib/ops.ts:4-13` — `GENERATION_OPS_EVENT_TYPES` const + `GenerationOpsEventType` type

Both define the same 8 event types. The investigation type is a plain TS union; the ops type is derived from a const array.

**Recommendation:** Use the const-array definition in `ops.ts` as the single source. Export the type and import it in `investigation.ts`. Also create a Convex validator from the same const and use it in `schema.ts` (see Audit 01).

### 4. `GenerationStatus` — defined 2 times

**Definitions:**
- `src/lib/ops/investigation.ts:15` — `type GenerationStatus = 'generating' | 'complete' | 'failed'`
- `src/convex/schema.ts:55-59` — inline `v.union` with the same literals

**Risk:** Schema changes won't propagate to the investigation types.

**Recommendation:** Export a `generationStatusValidator` from `validators.ts` and derive both the Convex schema field and the TS type from it.

### 5. `CriticalPathVerdict` — defined once but not shared with Convex

**Definition:**
- `src/lib/ops/investigation.ts:1-9` — `CRITICAL_PATH_VERDICTS` const + `CriticalPathVerdict` type

This type is only used in the ops investigation CLI, not in Convex. The values (`'pass' | 'fail' | 'in_flight' | 'not_applicable' | 'unknown'`) don't appear in the Convex schema. This is acceptable — the investigation module is a client-side analysis layer.

**Recommendation:** No change needed. The type is correctly scoped.

### 6. `DownloadProbe` — defined once, could be shared

**Definition:**
- `src/lib/ops/investigation.ts:27-34`

Used only in `GenerationArtifacts` within the same file. Not duplicated.

**Recommendation:** No change needed.

### 7. MCP proxy types — defined once, correctly scoped

**Definitions:**
- `src/lib/server/mcp-proxy.ts:43-59` — `McpProxyRequest`, `McpProxyResponse`, `McpProxyHandlerOptions`

These are used only in the SvelteKit MCP proxy layer. Not duplicated.

**Recommendation:** No change needed.

### 8. Production confidence types — well-organized single file

**Definition:**
- `src/lib/production-confidence/types.ts` — all types in one file

This is a well-organized domain type file with clear section markers. No duplication.

**Recommendation:** No change needed.

---

## Critical Assessment

The type duplication is concentrated in the **generation domain** — `GenerationStage`, `GenerationFailureKind`, `GenerationStatus`, and `OpsEventType` are all defined in both the Convex layer (`src/convex/`) and the client/ops layer (`src/lib/ops/`, `src/lib/analytics/`). This is partly architectural: Convex validators produce types via `Infer<>`, and the client-side types are plain TS unions. But the values are identical and must stay in sync.

The cleanest fix is to create a shared domain types module (e.g. `src/lib/generation-types.ts`) that exports both the const arrays and derived types, then import it from both Convex and client code. Convex validators in `validators.ts` can reference the same const arrays.

---

## Implementation Priority

| Priority | Item | Risk if not fixed |
|----------|------|-------------------|
| High | `GenerationStage` (3 definitions) | Stage additions drift across layers |
| High | `OpsEventType` (2 definitions + schema) | Event type additions drift |
| Medium | `GenerationFailureKind` (2 definitions) | Failure kind additions drift |
| Medium | `GenerationStatus` (2 definitions) | Status additions drift |
| Low | `CriticalPathVerdict` | Not duplicated — no action |
| Low | MCP proxy types | Not duplicated — no action |

---

## Resolution

**Date completed:** 2026-06-24  
**Status:** All high and medium priority items resolved.

### What was done

Created `src/lib/generation-types.ts` as the single source of truth for generation domain const arrays and derived TS types:
- `GENERATION_STAGES` / `GenerationStage`
- `GENERATION_FAILURE_KINDS` / `GenerationFailureKind`
- `GENERATION_STATUSES` / `GenerationStatus`
- `GENERATION_OPS_EVENT_TYPES` / `GenerationOpsEventType`

Updated `src/convex/lib/validation/validators.ts` to build all four Convex validators (`generationStageValidator`, `generationStatusValidator`, `generationFailureKindValidator`, `generationOpsEventTypeValidator`) from the shared const arrays instead of inline `v.literal()` unions.

Replaced all inline `v.union(v.literal(...))` blocks across the codebase with shared validators:
- `src/convex/schema.ts` — `status`, `failureKind`, `eventType` fields
- `src/convex/generations.ts` — 3 inline status unions, 2 inline failureKind unions, `generationStatusFilterValidator`
- `src/convex/generationReports.ts` — `generationStatusFilterValidator` and `GenerationStatusFilter` type
- `src/convex/ops.ts` — `recentOpsEventValidator.eventType`

Updated type-only consumers to import from `generation-types.ts`:
- `src/lib/ops/investigation.ts` — removed local `GenerationStage`, `GenerationFailureKind`, `GenerationStatus`, `OpsEventType` definitions; imports from shared module; `OpsTimelineEvent.eventType` now uses `GenerationOpsEventType`
- `src/lib/analytics/generation.ts` — removed local `GENERATION_FAILURE_KINDS`/`GENERATION_FAILURE_STAGES` consts; imports from shared module; `GenerationFailureStage` is now a type alias of `GenerationStage`
- `src/convex/lib/ops.ts` — removed local `GENERATION_OPS_EVENT_TYPES`/`GenerationOpsEventType`; imports and re-exports from shared module
- `src/convex/lib/generation/generationRun.ts` — imports `GenerationStage` from shared module, re-exports for backward compatibility with `generationOpsEvents.ts`

### Incidental fix

Fixed pre-existing mixed indentation (spaces vs tabs) in `SendOpsWebhookOptions` interface in `src/convex/lib/ops.ts` that caused a parse error and phantom `onError` property lint failures.

### Verification

- `pnpm typecheck:tsc` — pass
- `pnpm check` — 0 errors, 0 warnings
- `pnpm test` — 308 tests, 39 files, all pass
- `pnpm lint:ts` — pass
