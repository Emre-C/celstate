# Payment Implementation — Remaining Gaps & Production

> **Status**: Implemented (sandbox); production pending  
> **Last Updated**: 2026-03-11  
> **Product reference**: `docs/product/features/payments-system.md` — end-to-end payments and credits behavior.

This doc covers **remaining gaps**, **production Stripe setup**, and **testing required** before going live. Core flow (Stripe Checkout, webhook, creditGrants, weekly drip) is already implemented.

---

## 1. Remaining Gaps

### 1.1 Frontend price IDs (test vs prod)

**Current**: `src/routes/(app)/app/credits/+page.svelte` hardcodes Stripe price IDs:

```ts
const STARTER_PRICE_ID = 'price_1T9JXEADrsPdxsf7luMsEncJ';
const PRO_PRICE_ID = 'price_1T9JXFADrsPdxsf7jkGzXunA';
```

**Gap**: Same build cannot switch between Stripe test and live without code change. Test price IDs (`price_xxx`) differ from live (`price_live_xxx`).

**Options**:

- **A** — Convex query that returns price IDs from env (e.g. a small `getStripePriceIds` query reading `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO` from Convex env). Frontend calls it once and uses returned IDs for the Buy buttons. One build works for both test and prod Convex deployments.
- **B** — Public SvelteKit env (e.g. `PUBLIC_STRIPE_PRICE_STARTER`, `PUBLIC_STRIPE_PRICE_PRO`) set per environment in Vercel. Frontend reads `$env/static/public` or `$env/dynamic/public`. Requires build per environment or runtime config.

**Recommendation**: Option A — single source of truth in Convex env, no frontend secrets, aligns with existing Convex env usage.

### 1.2 Weekly drip audit trail (optional)

**Current**: `users.grantWeeklyCredit` only patches `users.credits`; it does not insert into `creditGrants`.

**Gap**: No audit row for “weekly_drip” grants. Harder to reconcile balance history or debug “where did my credits come from?” for free drip.

**Change**: In `grantWeeklyCredit`, after patching each user, insert a `creditGrants` row with `reason: "weekly_drip"`, `amount: 1`, `userId`, `createdAt`. No `stripePaymentIntentId`. Scale note: if user count grows, consider batching or a separate internal mutation called per user to avoid a single large transaction.

---

## 2. Connecting to Production (Live) Stripe

All of the following must be done **before** accepting real payments.

### 2.1 Stripe account and products

1. Activate Stripe account (complete business verification if required).
2. In Stripe Dashboard, create **live** products and one-time prices:
   - **Celstate Starter Pack** — $5.00 USD, one-time.
   - **Celstate Pro Pack** — $10.00 USD, one-time.
3. Note the **live** Price IDs (format `price_live_...`).

### 2.2 Convex production environment

1. Deploy Convex to production: `npx convex deploy --prod`.
2. In Convex Dashboard, select the **production** deployment.
3. Set environment variables for **production**:

| Variable | Value (production) |
|----------|--------------------|
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from the **live** webhook endpoint (see below) |
| `STRIPE_PRICE_STARTER` | `price_live_...` for $5 Starter |
| `STRIPE_PRICE_PRO` | `price_live_...` for $10 Pro |
| `HOSTING_URL` | Production origin, e.g. `https://celstate.com` |

Do **not** use test keys or test price IDs in production.

### 2.3 Stripe live webhook

1. In Stripe Dashboard → Developers → Webhooks, add endpoint:
   - URL: `https://<prod-deployment>.convex.site/stripe/webhook` (replace with your Convex production HTTP base URL).
2. Select events (minimum): `checkout.session.completed`, and any others required by `@convex-dev/stripe` (e.g. `customer.created`, `customer.updated`, `payment_intent.succeeded`, `payment_intent.payment_failed` — confirm against component docs).
3. Copy the **signing secret** (`whsec_...`) and set it as `STRIPE_WEBHOOK_SECRET` in Convex production env.

### 2.4 Frontend / hosting

- Ensure the app is deployed with the **production** `PUBLIC_CONVEX_URL` so it talks to the production Convex deployment.
- After implementing gap 1.1, ensure the credits page uses production price IDs (from Convex prod env or from public env pointing at prod).

---

## 3. Testing Before Production

Complete these **before** switching to live mode or enabling live payments.

### 3.1 Sandbox (test mode) verification

- [ ] **Checkout flow**: Sign in → go to `/app/credits` → click Buy Starter or Buy Pro → complete Stripe Checkout with test card `4242 4242 4242 4242`. Redirect back to site with success.
- [ ] **Credits granted**: After redirect, balance increases by 15 (Starter) or 40 (Pro). No page refresh required if Convex client is connected.
- [ ] **Audit trail**: In Convex Dashboard (Data), confirm a `creditGrants` row with `reason: "purchase"` and the correct `userId` and `stripePaymentIntentId`.
- [ ] **Idempotency**: Replay the same `checkout.session.completed` event (e.g. Stripe Dashboard → resend, or Stripe CLI). Confirm no second credit grant (check `creditGrants` and user balance).
- [ ] **Weekly drip**: Trigger the weekly cron (Convex Dashboard → Crons → run “weekly free credit” if available, or wait until Monday 14:00 UTC). Confirm every user gets +1 credit. Optionally after implementing 1.2, confirm a `creditGrants` row per user with `reason: "weekly_drip"`.
- [ ] **Insufficient credits**: Set user credits to 0 (or 1 and request 2 generations). Confirm generation request fails with a clear “Insufficient credits” (or equivalent) and no deduction.
- [ ] **Refund on failure**: Start a generation that will fail (e.g. invalid prompt or mock failure). Confirm credits are refunded and generation row is `status: "failed"`.

### 3.2 Local webhook testing (test mode)

- [ ] Run `stripe listen --forward-to <local-convex-tunnel>/stripe/webhook` (or equivalent for your Convex dev URL). Complete a test checkout and confirm webhook is received and credits are granted. Ensures signature verification and handler logic work with Stripe CLI events.

### 3.3 Production readiness (before going live)

- [ ] **Live products**: Live products and prices exist in Stripe Dashboard; live price IDs are in Convex production env.
- [ ] **Live keys**: Convex production has `sk_live_...` and **no** `sk_test_...`.
- [ ] **Live webhook**: Webhook endpoint uses production Convex URL; signing secret is from the **live** webhook, set in Convex production env.
- [ ] **HOSTING_URL**: Convex production `HOSTING_URL` is the real production origin so Stripe redirects (success/cancel) go to the right domain.
- [ ] **Price ID source**: If gap 1.1 is implemented, production frontend or Convex query uses production-only price IDs (no test IDs in prod).
- [ ] **Smoke test**: One real (small) live payment on production, then verify credits granted and audit row created. Optionally refund in Stripe Dashboard after verification.

---

## 4. Security Checklist (Recap)

- [ ] `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` only in Convex (never in frontend or public env).
- [ ] Credits granted only in webhook handler; success_url redirect does not grant credits.
- [ ] `createPaymentCheckout` requires authenticated user.
- [ ] Idempotency by `stripePaymentIntentId` before granting in `checkout.session.completed`.
- [ ] Price IDs and credit amounts defined server-side (Convex env + `CREDIT_PACKS`); client only sends `priceId`.

---

## 5. Obsolete Docs

- **CREDIT-MANAGEMENT.md** — Removed. Ad-hoc credit grant and future options are superseded by the Stripe implementation and `creditGrants` audit trail. Product behavior is described in `docs/product/features/payments-system.md`.
