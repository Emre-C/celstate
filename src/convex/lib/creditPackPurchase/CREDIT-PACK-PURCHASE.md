# Credit Pack Purchase Module

This directory contains pure helpers and Stripe port adapters for the credit-pack purchase lifecycle deepening plan in `docs/implementation/CREDIT-PACK-PURCHASE-DEEPENING.md`.

## Module boundary

- [`src/convex/creditPackPurchase.ts`](../../creditPackPurchase.ts) — Convex mutations and queries: user checkout, settlement/refund webhook entry points, canary runners, QA purge wrapper.
- [`src/convex/creditPackPurchaseActions.ts`](../../creditPackPurchaseActions.ts) — Node-only `internalAction`s that call Stripe via `productionStripeAdapter.ts`.
- `lifecycle.ts` — leases, settlement/refund persistence, Stripe webhook payload normalization (`normalizeStripeCheckoutSessionWebhookPayload`, `parseChargeRefundedWebhookPayload`, `parseRefundCreatedWebhookPayload`), `runProcessCheckout` / `runRefundCheckoutForCanary`.
- `catalog.ts` — fixed credit-pack catalog and price-id validation.
- `stripePort.ts` — Stripe adapter contract.
- `productionStripeAdapter.ts` — production Stripe SDK.
- `inMemoryStripeAdapter.ts` — deterministic test double for lifecycle tests.

## Webhook refund events

Prefer **`refund.created`** when the Stripe webhook endpoint API version supports it (see Stripe Acacia changelog). **`charge.refunded`** remains supported for older configurations. Register only one refund path in `http.ts` unless both are verified idempotent together.
