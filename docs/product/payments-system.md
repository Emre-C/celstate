# Payments System

## Overview

Celstate uses a **credit-based** payments model. Users spend credits to generate images. Credits are acquired via sign-up bonus, weekly free drip, and one-time Stripe purchases. No subscriptions — pay-per-pack when you need more.

**Product doc**: End-to-end behavior. For implementation gaps and production checklist, see `docs/implementation/PAYMENT-IMPLEMENTATION.md`.

---

## Pricing Model

| Tier | Price | Credits | Notes |
|------|-------|---------|--------|
| **Free** | $0 | 3 on sign-up + 1/week | Ongoing drip via cron |
| **Starter** | $5 | +15 credits | One-time purchase |
| **Pro** | $10 | +40 credits | One-time purchase, best value |

- **Cost per generation**: 1 credit = 1 image.
- **Credits never expire.**
- Paid packs stack on top of free tier; weekly drip continues for all users.
- Stripe mode is one-time **payment**, not subscription.

---

## Credit Flows

### 1. Sign-up (New Users)

On first sign-in (e.g. Google or Apple via Better Auth):

1. The app upserts the Convex `users` document (`upsertCurrentUser` → `upsertUserRecord` in `src/convex/users.ts`).
2. On **insert** (brand-new user), the row is created with `credits: GENERATION_CONFIG.initialCredits` (3).
3. Server-side PostHog captures a one-time `signed_up` event (same path).

Config: `src/convex/lib/config.ts` → `GENERATION_CONFIG.initialCredits: 3`.

### 2. Deduction (Generation)

When the user requests a generation:

1. `generations.requestGeneration` runs (args: `{ prompt, referenceStorageIds?, aspectRatio? }`).
2. Atomic check: `(user.credits ?? 0) >= creditsCost` (1 credit).
3. Credits are deducted and a `generations` row is inserted with `status: "generating"` (and reference image storage IDs if provided).
4. Worker is scheduled; UI updates reactively via `getMe` and generation query.

Double-spend is prevented by doing check-and-deduct in a single mutation.

### 3. Refund (Failure)

If the generation fails (Gemini errors, validation failures after max retries, dimension mismatch, or timeout):

1. Worker catches the error.
2. `generations.failGeneration` (via `failGenerationRecord` in `src/convex/generations.ts`) marks the row as `status: "failed"` with an error message and, if not already refunded, calls `users.applyCreditsToUser` to restore `creditsCost` and sets `creditRefundedAt` on the generation.

### 4. Stale Generation Cleanup

A cron runs every minute (`cleanupStaleGenerations`):

1. Finds generations stuck in `"generating"` with no progress longer than `GENERATION_CONFIG.staleGenerationTimeoutMs` (15 minutes; see `src/convex/lib/config.ts`).
2. Marks them as failed and refunds credits.

Refunds keep user balance correct when the worker never completes.

Additional hourly crons:

- `cleanupExpiredUploadUrlIssues` — garbage-collects the rate-limit tracking table for upload URL issuance.
- `cleanupOrphanedReferenceUploads` — deletes unreferenced image uploads older than 1 hour.

### 5. Purchase (Stripe)

1. User opens **Credits** (`/app/credits`), sees balance and Starter/Pro tiers.
2. Clicks "Buy Starter" or "Buy Pro" → frontend calls `pendingCheckouts.requestCheckout({ priceId })`. The mutation validates `priceId` against known credit-pack price IDs (`isKnownCreditPackPriceId`) before proceeding.
3. Convex schedules `stripe.processCheckout` (internal action): get-or-create Stripe customer, create Checkout Session (mode `"payment"`), store the checkout URL on the `pendingCheckouts` row; the client polls `getCheckoutStatus` (scoped to the owning user) then redirects to Stripe Checkout.
4. User completes Stripe-hosted Checkout, then redirected back to `/app?success=true` or `/app?canceled=true` (see `src/convex/stripe.ts`).
5. Stripe sends `checkout.session.completed` (or `checkout.session.async_payment_succeeded` for delayed payment methods) to Convex HTTP webhook (`src/convex/http.ts`). Credits are only granted when `mode === "payment"` and `payment_status === "paid"` (`canGrantCreditsForCheckoutSession`).
6. Custom handler: reads `userId` and `priceId` from session metadata, maps price to credits using the `CREDIT_PACKS` map in `src/convex/http.ts` (keys match `stripePriceStarter` / `stripePricePro` from env), checks idempotency by `stripePaymentIntentId`, then runs `creditGrants.recordPurchaseSettlement` (which applies credits via `users.applyCreditsToUser`, inserts a `creditGrants` audit row, and inserts a `purchaseSettlements` revenue record). After a successful grant, server-side PostHog emits `credits_purchase_completed` and an optional ops webhook alert runs (see Observability below).
7. Balance updates reactively via `getMe`; no polling.

Credits are granted **only** from the webhook, not from the success redirect.

### 6. Weekly Free Drip

A cron runs weekly (Monday 14:00 UTC / 9 AM CT):

1. `users.grantWeeklyCredit` runs.
2. Users below the weekly cap receive credits up to `GENERATION_CONFIG.weeklyDripCap` (1); each run inserts a `creditGrants` row with `reason: "weekly_drip"` for audit.

---

## Schema (Relevant Parts)

- **users**: `credits: v.optional(v.number())` — current balance.
- **generations**: `userId`, `creditsCost`, `status`, etc. — per-generation cost and status.
- **creditGrants**: `userId`, `amount`, `reason` (`signup_bonus` | `weekly_drip` | `purchase` | `admin_grant`), `stripePaymentIntentId?`, `createdAt` — audit trail for purchases, weekly drip, and future admin/signup grants.

Stripe component tables (customers, payments, checkout_sessions, etc.) live in the component namespace; our source of truth for balance is `users.credits`.

---

## UI

- **App nav**: Credit balance shown (e.g. “X credits”) via `getMe` in the app layout.
- **Credits page** (`/app/credits`): Current balance, Starter ($5 / 15 credits) and Pro ($10 / 40 credits) cards, “Buy” buttons that call `pendingCheckouts.requestCheckout` and redirect to Stripe when the checkout URL is ready. App home (`/app`) handles `?success=true` / `?canceled=true`; balance updates when the webhook has run.

---

## Security (Summary)

- Stripe secret and webhook secret live only in Convex env; frontend never sees them.
- Client only sends `priceId`; amounts are fixed in Stripe Dashboard and Convex `CREDIT_PACKS` map.
- `requestCheckout` validates `priceId` against known credit-pack price IDs (`isKnownCreditPackPriceId`) before creating a checkout session.
- Webhook handler verifies events via `@convex-dev/stripe`; our handler checks idempotency before granting credits. Both `checkout.session.completed` and `checkout.session.async_payment_succeeded` are handled.
- Credits are only granted for sessions with `mode === "payment"` and `payment_status === "paid"` (`canGrantCreditsForCheckoutSession`).
- `getCheckoutStatus` is scoped to the owning user (cannot read other users' checkout state).
- `pendingCheckouts.requestCheckout` runs `upsertCurrentUser` and requires an authenticated session.

---

## Observability (payments-related)

**Product doc** scope: what we emit and where. Runbooks: `docs/runbooks/ANALYTICS-OPS-PRODUCTION-SMOKE.md`.

| Layer | Mechanism | Payments-relevant events / behavior |
|-------|-----------|-------------------------------------|
| **Browser** | `posthog-js` via `src/lib/posthog.ts` (init in app layout) | `credits_purchase_initiated` on **Credits** when checkout is requested; `credits_checkout_returned` on return to `/app?success=true`; `identify` / `reset` with auth in `src/routes/(app)/app/+layout.svelte`. |
| **Convex (server)** | `@posthog/convex` — `src/convex/posthog.ts`, component in `src/convex/convex.config.ts` | `signed_up` when a new `users` row is inserted (`users.ts`). `credits_purchase_completed` inside the `checkout.session.completed` idempotency gate in `src/convex/http.ts` (authoritative revenue properties: `credits_added`, `amount_usd`, `currency`, `stripe_payment_intent_id`, `user_id`). |
| **Ops** | Optional webhook | If `OPS_ALERT_WEBHOOK_URL` is set (`src/convex/lib/ops.ts`), a purchase notification is sent once per successful grant (same gate as PostHog). |

Convex env for server capture: `POSTHOG_API_KEY`, `POSTHOG_HOST` (see runbook). Public client key: `PUBLIC_POSTHOG_KEY` / `PUBLIC_POSTHOG_HOST`.

For remaining implementation gaps and production/testing steps, see `docs/implementation/PAYMENT-IMPLEMENTATION.md`.
