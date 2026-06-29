# Credit-Pack Checkout Canary / Smoke-Pass Gameplan

**Status:** Current operational runbook
**Scope:** Validate the credit-pack checkout/settlement refactor end-to-end against live Stripe via the existing `verify:production` runner. Do **not** redesign the flow.
**Author:** Background agent
**Last updated:** 2026-05-09

---

## 1. Background context

### 1.1 The lifecycle under test

The credit-pack purchase lifecycle is owned by `src/convex/creditPackPurchase.ts`, `src/convex/creditPackPurchaseActions.ts`, and `src/convex/lib/creditPackPurchase/lifecycle.ts`.

Module owns:

- **Catalog**: `CREDIT_PACK_CATALOG` (Starter = 15 credits, Pro = 40 credits) and the priceId resolution via `getKnownCreditPackPriceIds`, `getCreditPackCatalog`, `getCreditPackByPriceId`, `assertKnownCreditPackPriceId`.
- **Checkout initiation**: `creditPackPurchase.requestCheckout` (writes a `pendingCheckouts` row and schedules `internal.creditPackPurchaseActions.processCheckout`).
- **Stripe Checkout Session args**: `buildStripeCheckoutSessionCreateParams` (mode, success/cancel URLs, metadata, payment intent metadata).
- **Webhook eligibility & extraction**: `canGrantCreditsForCheckoutSession`, `getCreditPackSettlementCandidate`. The candidate is the single source of truth for credits granted, payment intent, amount, currency, and userId; rejects unknown priceIds.
- **Settlement recording**: `recordPurchaseSettlementHelper` — idempotent across `pendingCheckoutId`, `stripePaymentIntentId`, and `creditGrants.by_payment_intent`. Returns `{ alreadyRecorded, settled, skipped }` with the settlement summary.
- **Refund recording**: `recordRefundForPaymentIntentHelper` handles `refund.created`; unmatched refunds are persisted in `pendingPurchaseRefunds` by payment intent and consumed during later settlement.

Compatibility adapter:

- `src/convex/stripe.ts` still forwards `internal.stripe.processCheckout` to `internal.creditPackPurchaseActions.processCheckout` for older scheduled jobs.

### 1.2 Behavior we must preserve

From [docs/features/credits-and-payments.yaml](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/features/credits-and-payments.yaml):

- One-time credit-pack purchases only — **no subscriptions**. `mode === "payment"` is enforced in `canGrantCreditsForCheckoutSession`.
- Starter $5 → 15 credits; Pro $10 → 40 credits. Credits granted only after webhook settlement.
- Settlement and grant recording must be **idempotent** — duplicate webhooks must not double-grant credits.

User-facing flow stays identical:

```
client requestCheckout
  → pendingCheckouts row (status=pending)
  → scheduler runs internal.creditPackPurchaseActions.processCheckout
  → Stripe Checkout Session created
  → markReady writes checkoutUrl
  → frontend polls getCheckoutStatus
  → Stripe redirects user to hosted checkout
  → user pays
  → checkout.session.completed | async_payment_succeeded webhook
  → handleCreditPackCheckout
  → creditPackPurchase.onStripeCheckoutCompleted
  → recordPurchaseSettlementHelper → applyCreditsToUser + creditGrants + purchaseSettlements
  → posthog credits_purchase_completed (+ Discord ops alert if configured)
```

### 1.3 Important invariant introduced by the refactor

**Credits granted are now derived from the central catalog inside the module, keyed by `priceId` from session metadata.** They are no longer passed in by the webhook adapter. This is the price-integrity property we most want to validate live: if the canary settles a real Starter pack, the user must end up with exactly **+15 credits**, not whatever the webhook caller might have asserted.

---

## 2. Findings from the local review

### 2.1 What looks correct

- **Single catalog source.** Both checkout-session creation (`buildStripeCheckoutSessionCreateParams`) and webhook settlement (`getCreditPackSettlementCandidate`) resolve credits via `assertKnownCreditPackPriceId` / `getCreditPackByPriceId`. There is no longer a parallel price-to-credits map in `src/convex/http.ts`.
- **Idempotency is centralized.** `recordPurchaseSettlementHelper` checks `purchaseSettlements.by_pending_checkout` *and* `purchaseSettlements.by_payment_intent` *and* `creditGrants.by_payment_intent` before applying credits. Convex mutation ACID/OCC keeps check-then-insert race-free, matching the convention in `docs/conventions/convex.md`.
- **Canary-runner path uses production lifecycle code.** `requestCheckoutForCanaryRunner` and `requestSettlementCheckoutForCanaryRunner` use the same helper as user-facing `requestCheckout`. The canary therefore exercises the production code path, not a parallel test-only one.
- **Refund canary still works.** `creditPackPurchaseActions.refundCheckoutForCanary` reads `getSettlementByPendingCheckoutForCanaryRunner`, calls Stripe with an idempotency key derived from `pendingCheckoutId`, and records the refund through `creditPackPurchase.recordRefundForCanary`.
- **Unknown priceIds are rejected.** `getCreditPackSettlementCandidate` returns `{ ok: false, reason: "Unknown credit pack priceId: ..." }` for prices outside the catalog. Covered by `src/convex/lib/creditPackPurchase/lifecycle.test.ts`.
- **Local gates were green** prior to the canary request: `pnpm check`, `pnpm typecheck:tsc`, `pnpm lint:ts`, `pnpm test`.

### 2.2 What only the live canary can prove

These are the properties unit tests cannot exercise — they are the **purpose** of running the smoke pass:

| # | Property | Why live-only |
|---|----------|---------------|
| F1 | `processCheckout` produces a real Stripe Checkout Session when called with the refactored arg builder. | Requires a real Stripe API call. |
| F2 | The hosted checkout URL we return matches what Stripe issues (no metadata or mode regression). | Requires the live customer + price + saved payment method on the canary principal. |
| F3 | `checkout.session.completed` webhook reaches Convex on prod and `getCreditPackSettlementCandidate` accepts it. | Requires the live `STRIPE_WEBHOOK_SECRET` and webhook delivery pipeline. |
| F4 | Credits granted equal the catalog value (+15 for Starter), idempotent across duplicate webhook deliveries. | Requires real ledger writes against the production deployment. |
| F5 | Purchase settlement row is created exactly once (revenueEventCount = 1, creditGrantCount = 1). | This is the `GRANTED_ONCE` outcome the canary classifier checks. |
| F6 | Refund clawback path still works post-refactor. | Required by every settlement canary run to leave production clean. |

### 2.3 Risk register / things to watch

- **Webhook signature secret unchanged.** The refactor does not touch `registerRoutes(http, components.stripe, ...)` registration in `src/convex/http.ts`, so existing `STRIPE_WEBHOOK_SECRET` config in Convex prod is still authoritative. If F3 fails, suspect environment, not the lifecycle module.
- **PostHog and ops alerts are best-effort.** Failures in PostHog capture or Discord webhook delivery only `console.error`; they do not block credit grants. Canary will not fail on those alone, but logs should still be checked post-run.
- **POSTHOG_API_KEY warning.** The webhook handler logs a hard error if `POSTHOG_API_KEY` is unset on the deployment. If this fires during the canary run, treat it as an environment drift, not a refactor regression.
- **Catalog drift is now caught at runtime, not at the webhook adapter.** If a new price ID is added to Stripe without updating the module, `getCreditPackSettlementCandidate` rejects the webhook with "Unknown credit pack priceId" — credits will not be granted. This is the intended fail-closed behavior.

---

## 3. Smoke-pass execution plan

### 3.1 Tooling — reuse what exists, do not invent

The repo-supported live entry point is `pnpm verify:production`, which runs [scripts/production-verification.ts](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/production-verification.ts). It exercises four domains:

1. **AUTH** — `/auth` page healthy, `/api/auth/session` returns sane status, optionally protected `/app` route reachable with stored session.
2. **GENERATION** — exercises image generation via `internal.generations.requestGenerationForCanaryRunner`. Not part of our refactor scope but runs anyway.
3. **CHECKOUT_SESSION** — exercises **checkout initiation** through the production seam (`internal.creditPackPurchase.requestCheckoutForCanaryRunner` -> `requestCreditPackCheckoutHelper` -> `creditPackPurchaseActions.processCheckout` -> `buildStripeCheckoutSessionCreateParams` -> Stripe -> `markReady`). Asserts `pendingObserved`, `readyObserved`, `hostedCheckoutUrlPresent`.
4. **LIVE_SETTLEMENT** *(SCHEDULED trigger only)* — full end-to-end: creates a settlement checkout, **drives Stripe hosted checkout via Playwright with the canary's saved payment method**, polls `settlement-by-checkout` until `GRANTED_ONCE` (or fault), then **refunds idempotently**. This is the path that proves F1–F6.

### 3.2 Required environment

Set these before invoking. **None are currently set in this shell**, which is why I stopped before running anything.

| Variable | Purpose | Notes |
|----------|---------|-------|
| `VERIFICATION_RUNNER_SECRET` | Bearer used by canary HTTP routes. | Must equal Convex prod env `VERIFICATION_RUNNER_SECRET`. |
| `CONVEX_URL` *(or `CONVEX_HTTP_VERIFICATION_URL`)* | Production deployment URL. | `*.convex.cloud`; runner derives `*.convex.site` automatically. |
| `PUBLIC_SITE_URL` *(or `AUTH_CANARY_BASE_URL`)* | Site origin for AUTH probes. | Production site URL. |
| `VERIFICATION_TRIGGER` | `POST_DEPLOY` (default) or `SCHEDULED`. | `SCHEDULED` is the one that runs LIVE_SETTLEMENT. |
| `AUTH_CANARY_PROTECTED_STORAGE_STATE` | Playwright storageState JSON for `/app`. | Required unless `AUTH_CANARY_REQUIRE_PROTECTED_ROUTE=false`. |
| `AUTH_CANARY_REQUIRE_PROTECTED_ROUTE` | `false` to skip protected-route proof. | Use only for emergency / refactor-only runs. |
| `GITHUB_SHA` / `VERCEL_GIT_COMMIT_SHA` | Recorded on the run. | Optional. |

Convex-side prerequisites that must already be true on the prod deployment (per [STRIPE-CONVEX-ENVIRONMENTS.md](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/runbooks/STRIPE-CONVEX-ENVIRONMENTS.md) and [CI-AND-CANARIES.md](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/runbooks/CI-AND-CANARIES.md)):

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` set (live keys on prod only).
- `STRIPE_PRICE_STARTER` and `STRIPE_PRICE_PRO` set.
- `CANARY_CHECKOUT` principal provisioned (auto-upserted by the runner).
- `CANARY_SETTLEMENT` principal provisioned **and** has a saved Stripe payment method on its customer (manual one-time setup; the runner cannot create payment methods). Without this, LIVE_SETTLEMENT throws "requires an existing Stripe customer with a saved payment method".

### 3.3 Recommended run order

**Two-phase approach** to isolate refactor risk before any real charge.

**Phase 1 — Non-destructive checkout-only canary (`POST_DEPLOY`)**

```bash
# Validates AUTH, GENERATION, CHECKOUT_SESSION. No real charges.
$env:VERIFICATION_TRIGGER = "POST_DEPLOY"
pnpm verify:production
```

Pass criteria:
- `CHECKOUT_SESSION` verdict `PASS` with `requestAccepted=true`, `pendingObserved=true`, `readyObserved=true`, `hostedCheckoutUrlPresent=true`.
- No `Unknown credit pack priceId` lines in Convex logs for canary checkout sessions.
- Release decision is not `DENY`.

If this fails, **do not proceed to Phase 2.** A `CHECKOUT_SESSION` failure most likely points at `creditPackPurchaseActions.processCheckout` or `buildStripeCheckoutSessionCreateParams`.

**Phase 2 — Full settlement canary (`SCHEDULED`)**

```bash
# Adds LIVE_SETTLEMENT: real $5 charge → webhook → grant → refund.
$env:VERIFICATION_TRIGGER = "SCHEDULED"
pnpm verify:production
```

Pass criteria (the refactor invariants in section 2.2):
- `LIVE_SETTLEMENT` verdict `PASS` with `paidWebhookObserved=true`, `creditGrantCount=1`, `authoritativeRevenueCount=1`, `refundObserved=true`.
- The pre-refund settlement classification reaches `GRANTED_ONCE`.
- Convex logs show no unexpected `creditPackPurchase.onStripeCheckoutCompleted` skipped outcomes and no duplicate-grant short-circuits beyond the expected idempotent webhook redelivery.
- Balance delta on the canary user during the run is exactly +15 then −15 (clawback) for Starter.

### 3.4 Abort / rollback criteria

Stop the canary and escalate if any of these occur:

- `LIVE_SETTLEMENT` outcome `DUPLICATE_GRANT` or `FAILED` (the runner already short-circuits on these — they imply ledger integrity breakage).
- Refund step (`/verification/canary/refund-settlement`) returns non-200 — leaves a paid canary settlement on prod. Manual refund via Stripe dashboard required, then call `internal.creditPackPurchase.recordRefundForCanary` (or let the `refund.created` webhook reconcile by payment intent) to reconcile the ledger.
- Webhook signature errors on `checkout.session.completed` in Convex logs. This points at env, not refactor — verify `STRIPE_WEBHOOK_SECRET`.
- Any verdict logged as `Unknown credit pack priceId: …` for the canary's own checkout. This implies the catalog and the live price IDs disagree.

### 3.5 Verification artifacts to capture

For each phase, save:

- The runner's stdout JSON summary (`runKey`, `releaseDecision`, `nonPassingRequiredDomains`).
- The Convex `verificationRuns` row created by `/verification/ingest`.
- The Convex `purchaseSettlements` row for Phase 2 with `refundedAt` populated.
- Stripe payment intent ID and refund ID for Phase 2 (in the `LIVE_SETTLEMENT` evidence row).

These are the artifacts referenced by [docs/features/production-confidence.yaml](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/features/production-confidence.yaml) for the deploy-gate audit trail.

---

## 4. What I will need from you to proceed

This is a destructive, production-only operation. I am **not** going to run `pnpm verify:production` until you confirm:

1. **Which trigger** to start with — `POST_DEPLOY` (Phase 1 only) or directly `SCHEDULED` (Phase 1 + 2). Recommend the two-phase approach.
2. **Provision of secrets in this shell** — `VERIFICATION_RUNNER_SECRET`, `CONVEX_URL`, `PUBLIC_SITE_URL`, optionally `AUTH_CANARY_PROTECTED_STORAGE_STATE`. Or confirm you would rather invoke this from your own workstation / CI and have me only review the resulting evidence rows.
3. **CANARY_SETTLEMENT readiness** — that the principal already has a saved Stripe payment method on prod. If not, Phase 2 cannot run; we must either provision it manually first or stop at Phase 1.
4. **Acknowledged real-money side effect** — Phase 2 will create and immediately refund a real $5 USD Starter pack charge against the live Stripe account. The refund is idempotent and automatic, but the charge does appear on the live ledger.

Once you confirm, the only remaining step on my side is to run the appropriate `pnpm verify:production` invocation, watch the JSON summary, and write up the evidence rows.

---

## 5. Out of scope for this pass

- No further refactoring. The architectural seam is intentionally fixed for this canary.
- No new test harness. We use `verify:production` and the existing canary HTTP routes.
- No changes to Stripe configuration, webhook secrets, or canary principal payment methods. Those are operator-managed.
- No PostHog / Discord ops alert reconfiguration. We observe their effects but do not touch their config.
