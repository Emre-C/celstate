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

On first sign-in via Google OAuth:

1. Convex Auth creates the user record.
2. `afterUserCreatedOrUpdated` in `src/convex/auth.ts` runs.
3. If `credits` is undefined, user is patched with `initialCredits` (3).

Config: `src/convex/lib/config.ts` → `initialCredits: 3`.

### 2. Deduction (Generation)

When the user requests a generation:

1. `generations.requestGeneration` runs.
2. Atomic check: `(user.credits ?? 0) >= creditsCost` (1 credit).
3. Credits are deducted and a `generations` row is inserted with `status: "generating"`.
4. Worker is scheduled; UI updates reactively via `getMe` and generation query.

Double-spend is prevented by doing check-and-deduct in a single mutation.

### 3. Refund (Failure)

If the generation fails (Gemini errors, validation failures after max retries, dimension mismatch, or timeout):

1. Worker catches the error.
2. `generations.refundCredits` restores `creditsCost` to the user.
3. `generations.failGeneration` marks the row as `status: "failed"` with an error message.

### 4. Stale Generation Cleanup

A cron runs every minute:

1. Finds generations stuck in `"generating"` longer than 5 minutes.
2. Marks them as failed and refunds credits.

Refunds keep user balance correct when the worker never completes.

### 5. Purchase (Stripe)

1. User opens **Credits** (`/app/credits`), sees balance and Starter/Pro tiers.
2. Clicks "Buy Starter" or "Buy Pro" → frontend calls `stripe.createPaymentCheckout({ priceId })`.
3. Convex action: get-or-create Stripe customer, create Checkout Session (mode `"payment"`), return Stripe Checkout URL.
4. User is redirected to Stripe-hosted Checkout, pays, then redirected back to the site.
5. Stripe sends `checkout.session.completed` to Convex HTTP webhook.
6. Custom handler: reads `userId` and `priceId` from session metadata, maps price to credits, checks idempotency by `stripePaymentIntentId`, then runs `creditGrants.recordGrant` (which calls `users.addCreditsByUserId` and inserts an audit row).
7. Balance updates reactively via `getMe`; no polling.

Credits are granted **only** from the webhook, not from the success redirect.

### 6. Weekly Free Drip

A cron runs weekly (Monday 14:00 UTC / 9 AM CT):

1. `users.grantWeeklyCredit` runs.
2. Every user gets +1 credit (patch to `users.credits`).

Early-stage implementation does not write a `creditGrants` row for weekly drip; that is an optional audit improvement.

---

## Schema (Relevant Parts)

- **users**: `credits: v.optional(v.number())` — current balance.
- **generations**: `userId`, `creditsCost`, `status`, etc. — per-generation cost and status.
- **creditGrants**: `userId`, `amount`, `reason` (`signup_bonus` | `weekly_drip` | `purchase` | `admin_grant`), `stripePaymentIntentId?`, `createdAt` — audit trail for credit grants (purchases and future admin/signup/weekly if we add them).

Stripe component tables (customers, payments, checkout_sessions, etc.) live in the component namespace; our source of truth for balance is `users.credits`.

---

## UI

- **App nav**: Credit balance shown (e.g. “X credits”) via `getMe` in the app layout.
- **Credits page** (`/app/credits`): Current balance, Starter ($5 / 15 credits) and Pro ($10 / 40 credits) cards, “Buy” buttons that trigger `createPaymentCheckout` and redirect to Stripe. Success/cancel return URLs show query params; balance updates when the webhook has run.

---

## Security (Summary)

- Stripe secret and webhook secret live only in Convex env; frontend never sees them.
- Client only sends `priceId`; amounts are fixed in Stripe Dashboard and Convex `CREDIT_PACKS` map.
- Webhook handler verifies events via `@convex-dev/stripe`; our handler checks idempotency before granting credits.
- `createPaymentCheckout` requires an authenticated user (`ctx.auth.getUserIdentity()`).

For remaining implementation gaps and production/testing steps, see `docs/implementation/PAYMENT-IMPLEMENTATION.md`.
