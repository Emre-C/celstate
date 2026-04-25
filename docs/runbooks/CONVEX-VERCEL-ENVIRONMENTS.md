# Convex + Vercel: dev vs production (prod-first)

**Audience:** anyone changing deploys or secrets. **Rule:** production is priority #1 — verify the **deployment** before every change.

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

Stripe, Vertex, Better Auth secrets, and `SITE_URL` are **per deployment**. See also [STRIPE-CONVEX-ENVIRONMENTS.md](./STRIPE-CONVEX-ENVIRONMENTS.md) and [Authentication](../product/authentication.md) (local dev).

---

## CLI rules (avoid touching prod by mistake)

| Intent | Command / action |
|--------|-------------------|
| Push code to **dev** only | `pnpm exec convex dev` (or `convex dev --once`) |
| Push code to **production** | `pnpm exec convex deploy` (from a clean tree; see [CLI deploy](https://docs.convex.dev/cli#deploy-convex-functions-to-production)) |
| List env vars on **dev** | `pnpm exec convex env list` |
| List env vars on **production** | `pnpm exec convex env list --prod` |
| Set env on **dev** | `pnpm exec convex env set NAME value` (no `--prod`) |
| Set env on **production** | `pnpm exec convex env set NAME value --prod` |
| Tail logs — dev | `pnpm exec convex logs` |
| Tail logs — prod | `pnpm exec convex logs --prod` |

**Before any `env set` or destructive action:** confirm in the [Convex dashboard](https://dashboard.convex.dev/) which deployment is selected (dev vs production).

**Do not** paste a dev `.env` dump into production. **Do not** use `sk_test_` Stripe keys on the production deployment.

---

## Vercel vs Convex responsibilities (Celstate)

**Public `PUBLIC_*` names on Vercel (Preview + Production):** see [PUBLIC-ENV-CHECKLIST.md](./PUBLIC-ENV-CHECKLIST.md) — required to avoid broken preview builds and dev/prod drift.

This repo follows **split deploys** (see [VERCEL-DEPLOYMENT.md](./VERCEL-DEPLOYMENT.md)):

- **Vercel** — SvelteKit frontend only. Public vars such as `PUBLIC_CONVEX_URL` / `PUBLIC_CONVEX_SITE_URL` so the browser knows which Convex deployment to use. No Stripe/Vertex/Better Auth secrets in Vercel.
- **Convex** — All backend secrets, webhooks, and HTTP actions.

Convex’s Vercel guide also describes an **integrated** workflow: build command `npx convex deploy --cmd 'npm run build'` plus `CONVEX_DEPLOY_KEY` on Vercel ([Using Convex with Vercel](https://docs.convex.dev/production/hosting/vercel)). Celstate may still deploy Convex **manually** from the machine; the same **prod vs preview vs dev** separation rules apply.

---

## Production checklist (before/after prod changes)

1. In the dashboard, select the **production** deployment.
2. After `convex deploy`, smoke-test auth, billing, and generation on the live site.
3. For env-only changes on prod, use `--prod` explicitly and double-check the key name and value (no test keys).

---

## Local development

- Point `.env.local` at the **development** Convex URLs for `PUBLIC_CONVEX_*`.
- Use `SITE_URL=http://localhost:5173` on the **dev** Convex deployment for Better Auth; production keeps the real canonical URL (see [Authentication](../product/authentication.md)).
