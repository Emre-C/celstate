# Stripe & Convex: dev vs production deployments

**Audience**: humans and CI/CD automation. **Goal**: never point paying customers at Stripe test mode or leak test secrets into production.

> **Source of truth for Stripe secrets is Doppler**, not Convex. Edit Stripe
> values (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`) in
> Doppler, then run `pnpm secrets:sync:convex` to propagate. To rotate a
> live Stripe key after a leak, follow
> [`MANUAL-SECRET-ROTATION-GUIDE.md`](./MANUAL-SECRET-ROTATION-GUIDE.md).
> Background: [`SECRETS-MANAGEMENT.md`](./SECRETS-MANAGEMENT.md).

Broader Convex + Vercel deploy rules (prod-first): [CONVEX-VERCEL-ENVIRONMENTS.md](./CONVEX-VERCEL-ENVIRONMENTS.md).

---

## TL;DR for CI/CD

| Rule | Detail |
|------|--------|
| **Two deployments** | Convex **development** and **production** are separate; each has its own env vars in the dashboard. |
| **Prod = live Stripe** | On the **production** deployment only: `STRIPE_SECRET_KEY` must be `sk_live_…`, prices must be live `price_…` from the live Stripe account, `STRIPE_WEBHOOK_SECRET` from the **live** webhook endpoint. |
| **Dev = test OK** | The dev deployment may use `sk_test_…`, test prices, and test `whsec_…`. |
| **CLI targeting** | Edit values in Doppler (`celstate/dev` or `celstate/prd`), then run `pnpm secrets:sync:convex:dev` or `pnpm secrets:sync:convex` to push. Never use `convex env set` directly. |
| **No blind sync** | Do not copy a `.env` or env dump from dev into prod. Do not “fix” prod by pasting `sk_test_` keys. |

---

## Why `SITE_URL` is not “environment detection”

`SITE_URL` is the app origin used for redirects (e.g. Stripe Checkout success URL). It may be the same canonical URL (`https://…`) on both Convex deployments if you mirror settings.

**Do not** infer “this is production” from `https:` vs `http:` or from `SITE_URL` alone. **Production** is whichever Convex deployment you deploy with `npx convex deploy` / label as production, and where live Stripe keys must live.

Runtime validation in `src/convex/lib/stripeEnv.ts` checks **presence and format** (e.g. key prefix, `price_`, `whsec_`). It does **not** reject “https site + test key” because that combination is valid on a **dev** deployment that shares the same `SITE_URL` as prod.

---

## Operational checklist (production)

Before or when going live with real charges:

1. In Doppler `prd`, set the following values (Doppler dashboard or
   `doppler secrets set NAME=value`):
   - `STRIPE_SECRET_KEY` — **live** secret key (`sk_live_…`).
   - `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO` — **live** price IDs from
     the Stripe dashboard (same mode as the key).
   - `STRIPE_WEBHOOK_SECRET` — signing secret (`whsec_…`) of the **live**
     webhook endpoint configured in Stripe to point at the Convex HTTP
     action.
   - `SITE_URL` / `HOSTING_URL` — your real public origin (e.g.
     `https://www.celstate.com`).
2. Run `pnpm secrets:sync:convex` to propagate to Convex prod atomically.
3. In the Convex dashboard, confirm the **production** deployment shows
   the expected names (use `pnpm secrets:diff` from a terminal — never
   `convex env list`).

Related: [Credits & Payments](../features/credits-and-payments.yaml), [Vercel Deployment](./VERCEL-DEPLOYMENT.md).

---

## Common mistakes

- **Editing Convex env directly instead of Doppler** — Doppler immediately drifts from Convex. Always edit in Doppler, then sync.
- **Forgetting to sync after a Doppler edit** — Doppler has the truth, Convex still has the old value. Run `pnpm secrets:sync:convex` after every Doppler edit.
- **Running `convex env list` to "double-check"** — that's the original leak vector. Use `pnpm secrets:diff` for safe inspection (names only, never values).
- **Using test webhook secret with live key** (or the reverse) — Webhooks fail or verify against the wrong endpoint.
- **Assuming one global `SITE_URL`** proves prod — It does not; deployment + Stripe key mode does.

---

## Code reference

- `src/convex/lib/stripeEnv.ts` — `assertStripeEnv()` at Stripe entry points (e.g. `http.ts`, `stripe.ts`, `users.ts`).
