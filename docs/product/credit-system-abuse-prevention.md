# Credit System Abuse Prevention

## Overview

Celstate's credit system includes server-side abuse controls around generation requests, reference uploads, and Stripe fulfillment. These safeguards are part of the shipped product, not a planned hardening pass.

The system is designed to protect against four concrete failure modes:

- expensive work starting without an available credit balance
- excessive parallel generation load from a single user
- unbounded reference upload or prompt payload costs
- duplicate or invalid Stripe credit grants

This document describes the behavior currently enforced in production-facing code.

---

## Current Safeguards

### Atomic credit spend

Generation spend happens inside a single Convex mutation in `src/convex/generations.ts`. The mutation reads the current balance, rejects insufficient-credit requests, deducts the generation cost, inserts the `generations` row, and schedules work in one server-side path.

This prevents client-side bypasses and closes the usual check-then-deduct race window.

### Concurrent generation cap

Before deducting credits, `requestGeneration` counts the caller's in-flight `"generating"` rows and rejects the request when the count reaches `GENERATION_CONFIG.maxConcurrentGenerations`.

Current limit:

```ts
maxConcurrentGenerations: 3
```

This keeps one user from fanning out a large number of simultaneous Gemini jobs.

### Prompt length cap

Generation requests are rejected when `prompt.length` exceeds `GENERATION_CONFIG.maxPromptLength`.

Current limit:

```ts
maxPromptLength: 20_000
```

This bounds input size before expensive model work starts.

### Reference upload credit gate

`generateUploadUrl` checks that the authenticated user has at least `creditsPerGeneration` before issuing a Convex storage upload URL.

That means reference uploads are not available to users who cannot currently afford a generation.

### Upload URL issuance throttle

Reference upload URL issuance is rate-limited per user using the `referenceUploadUrlIssues` table. The mutation reads recent rows via the `by_user_createdAt` index and rejects requests that exceed the rolling-window limit.

Current limits:

```ts
uploadUrlIssueWindowMs: 15 * 60 * 1000
maxUploadUrlIssuesPerWindow: 3 * 14
```

At today's configuration, a user can mint at most `42` reference upload URLs in a `15` minute window, matching the current maximum of `3` concurrent generations with `14` reference images each.

### Reference image validation

Before a generation is accepted, every supplied reference storage ID is validated against Convex storage metadata.

Current validation rules:

- the file must exist
- the file must be `image/jpeg`, `image/png`, or `image/webp`
- the file must be no larger than `GENERATION_CONFIG.referenceMaxSizeBytes`
- duplicate storage IDs are rejected
- the request cannot exceed `GENERATION_CONFIG.maxReferenceImages`

Current limits:

```ts
referenceMaxSizeBytes: 7 * 1024 * 1024
maxReferenceImages: 14
```

This prevents unsupported, missing, oversized, or repeated files from reaching the expensive generation pipeline.

### Failed-job refunds

Credits are restored when a generation fails after spend has already occurred.

Two server-side recovery paths are in place:

- the worker failure path refunds credits when a generation transitions to `"failed"`
- the `cleanupStaleGenerations` cron refunds credits for jobs stuck in `"generating"`

This keeps balance integrity intact even when generation work crashes or stalls.

### Orphaned upload cleanup

Celstate also cleans up the storage-side artifacts created by abandoned or incomplete generation attempts.

Hourly cleanup jobs remove:

- expired rows in `referenceUploadUrlIssues`
- orphaned image uploads older than `GENERATION_CONFIG.orphanedUploadMaxAgeMs` that are not referenced by any generation record

This reduces the cost of abandoned uploads and prevents the rate-limit tracking table from growing without bound.

### Stripe checkout hardening

Stripe purchase fulfillment is also protected by server-side abuse controls.

Current behavior:

- only known Starter and Pro credit-pack price IDs are accepted when a checkout is requested
- checkout sessions are created in `mode: "payment"`
- credits are granted only when the webhook session is both `mode === "payment"` and `payment_status === "paid"`
- both `checkout.session.completed` and `checkout.session.async_payment_succeeded` are handled
- purchase settlement is deduplicated by `stripePaymentIntentId`
- checkout status queries only return data to the owning user

Credits are granted from the webhook settlement path, not from the browser return URL.

### Internal-only grant paths

Credit grant and refund flows are kept on internal server-side APIs.

Current internal-only paths include:

- purchase settlement recording
- direct credit application helpers
- weekly drip grants

This limits the public attack surface to the intended request entry points.

---

## Configuration

The shipped abuse-prevention knobs live in `src/convex/lib/config.ts` under `GENERATION_CONFIG`.

```ts
creditsPerGeneration: 1,
weeklyDripCap: 1,
maxConcurrentGenerations: 3,
maxPromptLength: 20_000,
uploadUrlIssueWindowMs: 15 * 60 * 1000,
maxUploadUrlIssuesPerWindow: 3 * 14,
referenceMaxSizeBytes: 7 * 1024 * 1024,
maxReferenceImages: 14,
orphanedUploadMaxAgeMs: 60 * 60 * 1000,
```

---

## Current Boundaries

The abuse-prevention system is implemented, but its scope is intentionally narrow.

What is not currently part of the shipped credit-abuse layer:

- auth-layer protections against throwaway account farming such as CAPTCHA or signup rate limiting
- sequential per-user velocity limits beyond the concurrent-generation cap
- an append-only deduction ledger for every credit spend

Those are separate product or infrastructure decisions rather than missing pieces of the existing safeguard system.
