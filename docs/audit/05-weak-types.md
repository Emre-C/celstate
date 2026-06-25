# Audit 05: Remove Weak Types (`any`, `unknown`)

**Date:** 2026-06-24  
**Scope:** `src/`, `scripts/`  
**Tools:** grep, manual code review

---

## Summary

The codebase has **zero `any` usage** — a strong baseline. `unknown` is used in ~30 locations, most of which are legitimate type-safe narrowing patterns for untrusted input. A small number could be tightened with proper type definitions.

---

## Findings

### No `any` usage

Grep for `: any`, `as any`, `<any>` across `src/` and `scripts/` returned zero results. The codebase consistently uses `unknown` instead of `any` for untyped values, which is the correct TypeScript pattern.

### `unknown` usage — categorized

#### Category 1: Legitimate — error type narrowing (8 locations)

These use `unknown` for caught errors, which is the TypeScript best practice (`catch (e: unknown)`).

- `src/lib/auth/protected-session.ts:130,153` — `normalizeUserSyncErrorMessage(error: unknown)`
- `src/lib/analytics/generation.ts:68,72` — `isGenerationFailureKind(value: unknown)`, `normalizeGenerationFailureStage(value: unknown)`
- `src/convex/mcp/toolResults.ts:16` — `getErrorMessage(error: unknown)`
- `src/convex/lottieGeneration.ts:38` — `normalizeGenerationError(error: unknown)`
- `src/convex/lib/verification/verificationRunnerSecret.ts:20` — `isVerificationUnauthorizedError(error: unknown)`
- `src/convex/lib/qa/qaUserResetSecret.ts:18` — `isQaUserResetUnauthorizedError(error: unknown)`
- `src/routes/(app)/app/animations/+page.svelte:40` — `normalizeError(error: unknown)`

**Verdict:** Correct usage. No change needed.

#### Category 2: Legitimate — JSON parsing of untrusted input (10 locations)

These parse external JSON (API responses, env vars, webhook payloads) where the shape is unknown until validated.

- `src/convex/ops.ts:214` — `JSON.parse(json)` for GCP service account
- `src/convex/ops.ts:457-459` — webhook payload parsing with `artifactDownloadReachable?: unknown`
- `src/convex/lib/gemini.ts:75` — `parseServiceAccountJson(raw: string)` 
- `src/convex/lib/creditPackPurchase/lifecycle.ts:86,165,242` — `normalizeStripeCheckoutSessionWebhookPayload(input: unknown)`, `parseChargeRefundedWebhookPayload(input: unknown)`, `parseRefundCreatedWebhookPayload(input: unknown)`
- `src/lib/server/mcp-proxy.ts:130` — `JSON.parse(...)` for MCP JSON-RPC method detection
- `src/lib/server/mcp-proxy.ts:212` — `lastError: unknown` for retry loop
- `src/lib/components/LottiePreview.svelte:38` — `(await response.json()) as unknown`

**Verdict:** Correct usage — these are external input boundaries. The code properly narrows with runtime checks after parsing. No change needed.

#### Category 3: Legitimate — Lottie JSON validation (8 locations)

The Lottie validation module uses `unknown` for the parsed Lottie JSON because Lottie files are arbitrary JSON that must be structurally validated before use.

- `src/convex/lib/lottie/lottieValidation.ts:20,24,28,30,40,54,57,105,124,240` — `lottie: unknown`, `JsonRecord = Record<string, unknown>`, `isRecord(value: unknown)`, `collectSidFallbackErrors(value: unknown)`, `collectExpressionErrors(value: unknown)`, `normalizeLottieJsonForStorage(lottie: unknown)`
- `src/convex/lottieGeneration.ts:69,98,111` — `lottie: unknown` propagated from validation

**Verdict:** Correct usage — Lottie JSON is untrusted and must be validated. The validation module properly narrows with `isRecord()` and field checks. No change needed.

#### Category 4: Could be tightened (4 locations)

1. **`src/convex/lib/creditPackPurchase/lifecycle.ts:167,244`** — `input as Record<string, unknown>` casts after `typeof input === "object"` check. The code then accesses specific fields (`charge`, `refund`, `payment_intent`, etc.) with `as` casts.

   **Recommendation:** Define `StripeChargeObject` and `StripeRefundObject` interfaces with the specific fields accessed, and use a type guard function instead of `as Record<string, unknown>`. This would catch typos in field names at compile time.

2. **`src/lib/server/mcp-proxy.ts:130`** — `JSON.parse(...)` cast to `{ method?: unknown }`. The `method` field is then checked with `typeof payload.method === "string"`.

   **Recommendation:** Define a `JsonRpcRequest` type with `method?: string` and cast to that instead. Minor improvement.

3. **`scripts/ops/production-verification.ts:276,374`** — `sessionBody.authenticated?: unknown` and `body: unknown = {}` for API response parsing.

   **Recommendation:** Define response body interfaces (`{ authenticated: boolean }`, `{ ok: boolean }`) and cast to those.

4. **`scripts/lib/posthog-api.ts:13-14`** — `results?: unknown[][]` and `timings?: Record<string, unknown>` for PostHog API response.

   **Recommendation:** Check PostHog API docs for the actual response types and define them. Low priority since this is a CLI tool.

#### Category 5: Test files (3 locations)

- `src/lib/server/mcp-proxy.test.ts:20` — `encodeJson(value: unknown)`
- `src/lib/mcp/proxy-adapter.test.ts:14` — `encodeJson(value: unknown)`
- `src/lib/server/clerk-guard.test.ts:16` — `catch (e: unknown)`

**Verdict:** Correct usage in test helpers. No change needed.

---

## Critical Assessment

The codebase has excellent type discipline — zero `any` usage and `unknown` is used correctly as a type-safe boundary for untrusted input. The only improvements are in the Stripe webhook payload parsing (lifecycle.ts) where `Record<string, unknown>` could be replaced with specific Stripe object interfaces.

The Lottie validation module's heavy `unknown` usage is architecturally correct — it's a validation layer that must prove the shape of arbitrary JSON before passing it downstream.

---

## Implementation Priority

| Priority | Item | Risk if not fixed |
|----------|------|-------------------|
| Medium | Stripe webhook payload types in `lifecycle.ts` | Field access typos not caught at compile time |
| Low | MCP JSON-RPC request type | Minor type safety improvement |
| Low | PostHog API response types | CLI-only, low impact |
| None | Error narrowing, Lottie validation, test helpers | Correct usage — no action |
