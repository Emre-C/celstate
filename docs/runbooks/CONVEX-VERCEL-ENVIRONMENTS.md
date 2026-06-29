# Convex + Vercel: dev vs production (prod-first)

**Audience:** anyone changing deploys or secrets. **Rule:** production is priority #1 — verify the **deployment** before every change.

> **Doppler is the source of truth for all secrets.** Prefer editing in Doppler and running
> `pnpm secrets:sync:convex:dev` (dev) or `pnpm secrets:sync:convex` (prod); those scripts invoke
> `convex env set` under the hood. Do not run `convex env list`
> (it leaks plaintext into terminal history and any AI-assistant context
> capturing the session). Use `pnpm secrets:diff` for safe inspection. Full
> details: [`SECRETS-MANAGEMENT.md`](./SECRETS-MANAGEMENT.md).

Official references (Convex Developer Hub):

| Topic | Documentation |
|--------|----------------|
| Environment variables (per-deployment, CLI, `--prod`) | [Environment variables](https://docs.convex.dev/production/environment-variables) |
| CLI (`convex dev`, `convex deploy`, `convex env`) | [CLI](https://docs.convex.dev/cli) |
| Vercel hosting (`convex deploy --cmd`, deploy keys, previews) | [Using Convex with Vercel](https://docs.convex.dev/production/hosting/vercel) |
| Preview deployments | [Preview deployments](https://docs.convex.dev/production/hosting/preview-deployments) |
| Production overview | [Deploying to production](https://docs.convex.dev/production) |

---

## Two Convex deployments

Every Convex **project** has separate **development** and **production** deployments: different data, different functions revision, **different environment variables**.

- **Development** — what `pnpm exec convex dev` syncs to; default target for `convex env`, `convex run`, `convex logs` (without flags).
- **Production** — what users rely on; only change when you intend to ship backend changes or prod-specific config.

Stripe, Vertex, Clerk (`CLERK_JWT_ISSUER_DOMAIN` for JWT validation), and hosting metadata such as `SITE_URL` are **per deployment**. See also [STRIPE-CONVEX-ENVIRONMENTS.md](./STRIPE-CONVEX-ENVIRONMENTS.md) and [Authentication](../features/authentication.yaml) (local dev).

---

## CLI rules (avoid touching prod by mistake)

| Intent | Command / action |
|--------|-------------------|
| Push code to **dev** only | `pnpm deploy:convex` (one-shot `convex dev --once`; does not watch) |
| Push code to **production** | `pnpm deploy:convex:prod` (bounded wrapper around [CLI deploy](https://docs.convex.dev/cli#deploy-convex-functions-to-production)) |
| Compare env vars (names only, safe) | `pnpm secrets:diff` |
| Update env vars on **dev** | Edit in Doppler `dev`, then `pnpm secrets:sync:convex:dev` |
| Update env vars on **production** | Edit in Doppler `prd`, then `pnpm secrets:sync:convex` |
| Tail logs — dev | `pnpm exec convex logs` |
| Tail logs — prod | `pnpm exec convex logs --prod` |

**Before any prod sync or destructive action:** confirm in the [Convex dashboard](https://dashboard.convex.dev/) which deployment is selected (dev vs production), and verify the diff with `pnpm secrets:diff`.

**Do not** run `convex env list` (any flag) — see the warning at the top of this doc. **Do not** paste a dev `.env` dump into production. **Do not** use `sk_test_` Stripe keys on the production deployment.

---

## Vercel vs Convex responsibilities (Celstate)

**Public `PUBLIC_*` names on Vercel (Preview + Production):** see [PUBLIC-ENV-CHECKLIST.md](./PUBLIC-ENV-CHECKLIST.md) — required to avoid broken preview builds and dev/prod drift.

This repo follows **split deploys** (see [VERCEL-DEPLOYMENT.md](./VERCEL-DEPLOYMENT.md)):

- **Vercel** — SvelteKit frontend. `PUBLIC_*` for the browser **plus** `CLERK_SECRET_KEY` / optional `SENTRY_DSN` for Clerk (synced from Doppler). Stripe/Vertex secrets stay on Convex only.
- **Convex** — All backend secrets, webhooks, and HTTP actions.

Convex’s Vercel guide also describes an **integrated** workflow: build command `npx convex deploy --cmd 'npm run build'` plus `CONVEX_DEPLOY_KEY` on Vercel ([Using Convex with Vercel](https://docs.convex.dev/production/hosting/vercel)). Celstate deploys Convex through `pnpm deploy:convex` / `pnpm deploy:convex:prod`; the same **prod vs preview vs dev** separation rules apply.

---

## Production checklist (before/after prod changes)

1. In the dashboard, select the **production** deployment.
2. After `pnpm deploy:convex:prod`, smoke-test auth, billing, and generation on the live site.
3. For env-only changes on prod, use `--prod` explicitly and double-check the key name and value (no test keys).

---

## Local development

- Point `.env.local` at the **development** Convex URLs for `PUBLIC_CONVEX_*`.
- Keep `SITE_URL` / `PUBLIC_SITE_URL` aligned on the **dev** Convex + Vite origins (see [Authentication](../features/authentication.yaml)); production keeps the real canonical URL.
