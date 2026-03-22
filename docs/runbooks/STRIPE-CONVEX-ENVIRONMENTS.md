# Stripe & Convex: dev vs production deployments

**Audience**: humans and CI/CD automation. **Goal**: never point paying customers at Stripe test mode or leak test secrets into production.

Broader Convex + Vercel deploy rules (prod-first): [CONVEX-VERCEL-ENVIRONMENTS.md](./CONVEX-VERCEL-ENVIRONMENTS.md).

---

## TL;DR for CI/CD

| Rule | Detail |
|------|--------|
| **Two deployments** | Convex **development** and **production** are separate; each has its own env vars in the dashboard. |
| **Prod = live Stripe** | On the **production** deployment only: `STRIPE_SECRET_KEY` must be `sk_live_…`, prices must be live `price_…` from the live Stripe account, `STRIPE_WEBHOOK_SECRET` from the **live** webhook endpoint. |
| **Dev = test OK** | The dev deployment may use `sk_test_…`, test prices, and test `whsec_…`. |
| **CLI targeting** | `npx convex env set …` without `--prod` affects the **dev** deployment. Use `--prod` when changing production secrets. |
| **No blind sync** | Do not copy a `.env` or env dump from dev into prod. Do not “fix” prod by pasting `sk_test_` keys. |

---

## Why `SITE_URL` is not “environment detection”

`SITE_URL` is the app origin used for redirects (e.g. Stripe Checkout success URL). It may be the same canonical URL (`https://…`) on both Convex deployments if you mirror settings.

**Do not** infer “this is production” from `https:` vs `http:` or from `SITE_URL` alone. **Production** is whichever Convex deployment you deploy with `npx convex deploy` / label as production, and where live Stripe keys must live.

Runtime validation in `src/convex/lib/stripeEnv.ts` checks **presence and format** (e.g. key prefix, `price_`, `whsec_`). It does **not** reject “https site + test key” because that combination is valid on a **dev** deployment that shares the same `SITE_URL` as prod.

---

## Operational checklist (production)

Before or when going live with real charges:

1. In the Convex dashboard, select the **production** deployment.
2. Set `STRIPE_SECRET_KEY` to a **live** secret key (`sk_live_…`).
3. Set `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO` to **live** price IDs from the Stripe dashboard (same mode as the key).
4. Create/configure the **live** webhook endpoint in Stripe; set `STRIPE_WEBHOOK_SECRET` to that endpoint’s signing secret (`whsec_…`).
5. Set `SITE_URL` to your real public origin (e.g. `https://www.example.com`).

Related: [PAYMENT-IMPLEMENTATION.md](./PAYMENT-IMPLEMENTATION.md), [PRODUCTION-DEPLOYMENT.md](./PRODUCTION-DEPLOYMENT.md).

---

## Common mistakes

- **Setting prod secrets without `--prod`** — Updates only dev; prod still has old keys or is missing vars.
- **Using test webhook secret with live key** (or the reverse) — Webhooks fail or verify against the wrong endpoint.
- **Assuming one global `SITE_URL`** proves prod — It does not; deployment + Stripe key mode does.

---

## Code reference

- `src/convex/lib/stripeEnv.ts` — `assertStripeEnv()` at Stripe entry points (e.g. `http.ts`, `stripe.ts`, `users.ts`).
