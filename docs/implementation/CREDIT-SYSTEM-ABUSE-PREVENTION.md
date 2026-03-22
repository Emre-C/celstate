# Credit System — Abuse Prevention

> **Status**: Initial guards implemented  
> **Last Updated**: 2026-03-17

This document describes the threat model for Celstate's credit-based currency system, what server-side guards are currently in place, and areas to continue investigating.

---

## Problem

Every generation costs real money (Gemini API call + Convex storage + compute). Credits are the only gate between a user and that spend. If a bad actor can bypass, inflate, or exhaust credits faster than intended — or consume expensive resources without spending credits at all — they can drive up infrastructure costs disproportionately.

The core risks fall into a few categories:

- **Resource consumption without credit spend** — endpoints that use expensive resources (storage, compute) but don't require or deduct credits.
- **Amplification** — a user with legitimate credits triggering disproportionate backend cost (parallel requests, oversized payloads).
- **Credit farming** — obtaining free credits at scale through repeated signups or exploiting grant logic.
- **Race conditions** — concurrent requests that bypass balance checks.

---

## Existing Architecture (context)

- Credits are a `number` field on the `users` table. All mutations that read + deduct run inside a single Convex mutation (serialized per-document, no race conditions).
- Stripe webhook grants are idempotent — deduplicated by `stripePaymentIntentId` in the `creditGrants` table.
- Weekly drip (`grantWeeklyCredit`) caps users to `weeklyDripCap`, never additive above the cap.
- Failed generations refund credits (both in the worker catch block and the stale generation cleanup cron).
- All grant/deduct logic lives in `internalMutation` — not exposed to clients.

---

## Implemented Guards

### 1. Concurrent generation cap

**File**: `src/convex/generations.ts` — `requestGeneration`  
**Config**: `GENERATION_CONFIG.maxConcurrentGenerations` (currently `3`)

Before deducting credits, the mutation counts the user's in-flight `"generating"` rows. If the count meets or exceeds the cap, the request is rejected. This prevents a user from launching dozens of parallel Gemini API calls simultaneously.

### 2. Prompt length limit

**File**: `src/convex/generations.ts` — `requestGeneration`  
**Config**: `GENERATION_CONFIG.maxPromptLength` (currently `20,000`)

Rejects prompts exceeding the character limit. Extremely long prompts inflate Gemini input token costs.

### 3. Upload URL credit gate

**File**: `src/convex/generations.ts` — `generateUploadUrl`

The `generateUploadUrl` mutation now checks that the user has at least `creditsPerGeneration` credits before issuing a storage upload URL. Previously, any authenticated user could generate unlimited upload URLs and flood Convex storage with files regardless of credit balance.

### 4. Pre-existing safeguards

- Atomic credit check + deduct (Convex mutation serialization)
- Stripe webhook idempotency via `paymentIntentId`
- Reference image count cap (`maxReferenceImages: 14`)
- Stale generation cleanup cron (refunds credits for stuck jobs)

---

## Configuration

All abuse-prevention constants live in `src/convex/lib/config.ts` under `GENERATION_CONFIG`:

```ts
maxConcurrentGenerations: 3,
maxPromptLength: 20_000,
```

These can be tuned without code changes beyond updating the constant.

---

## Areas to Explore

The following are not exhaustive — they're starting points for continued hardening as usage patterns emerge.

- **Account farming**: New users receive `initialCredits` on signup. If auth allows easy throwaway account creation, this could be exploited at scale. Mitigations might live at the auth layer (CAPTCHA, email verification requirements, signup rate limiting) rather than the credit system.

- **Per-user rate limiting**: The concurrent cap prevents parallel abuse, but doesn't limit sequential velocity. A user could still burn through purchased credits very quickly, spiking Gemini costs. A per-user cooldown or hourly generation cap could smooth this out if it becomes a problem.

- **Reference image payload cost**: 14 reference images × 10MB each = 140MB uploaded and sent to Gemini as base64 per generation. This is a significant token cost multiplier. Worth monitoring whether the reference image limits need tightening, or whether per-generation input size should be bounded.

- **Storage cleanup for orphaned uploads**: If a user uploads reference images via `generateUploadUrl` but never submits a generation, those files sit in Convex storage indefinitely. A periodic cleanup of unreferenced storage objects could control storage costs.

- **Observability**: Logging or alerting on unusual patterns (e.g., a user generating at maximum concurrency continuously, or a spike in failed generations) would help surface abuse early. See `GROWTH-OBSERVABILITY-AGENT-SPEC.md` for observability routing and growth analytics scope.

- **Credit balance integrity**: The `credits` field is a plain number with no audit log for deductions (only grants are logged in `creditGrants`). If deeper auditability is ever needed, a ledger-style approach (append-only transactions) could replace the current mutable balance.
