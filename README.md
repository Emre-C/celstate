# Celstate

A focused tool for **transparent-background PNGs** from a text prompt—no background-removal step after the fact. The app is a **SvelteKit** frontend on **Convex** (realtime data, storage, scheduled work) with **Stripe** credit packs and product analytics.

Primary product docs live in [`docs/product/`](docs/product/); deployment and operations runbooks live in [`docs/runbooks/`](docs/runbooks/). Documentation retention rules live in [`docs/README.md`](docs/README.md).

## What it does today

- **Transparent images** — Dual-pass generation on white/black backgrounds, then **difference matting** for exact alpha (see [`docs/product/image-generation.md`](docs/product/image-generation.md)). Inference uses **Vertex AI** (Generative AI on Vertex), not the Gemini Developer API key flow.
- **Style references** — Optional reference image(s) steer palette and look; text-only mode when none are attached.
- **Credits** — Balance shown in-app; generations deduct credits; failures refund. **Sign-up bonus**, **weekly free drip**, and **one-time Stripe packs** (no subscriptions). Details: [`docs/product/payments-system.md`](docs/product/payments-system.md).
- **Auth** — **Better Auth on Convex** with a SvelteKit proxy; **Google** sign-in live; **Apple** implemented but disabled until Apple-side setup is done; **no email/password**. Server-side guards for `/app/*`. Details: [`docs/product/authentication.md`](docs/product/authentication.md).
- **Agent access** — Celstate ships a hosted **remote MCP server** plus an optional local proxy package for enterprise networking or local URL needs. Details: [`docs/product/mcp-server.md`](docs/product/mcp-server.md).
- **Observability** — **PostHog** (client + Convex server capture), **Sentry** on the SvelteKit app, optional **ops webhooks** (e.g. Slack/Discord) for purchases and generation alerts. Convex workers do not use Sentry. Overview: [`docs/product/observability.md`](docs/product/observability.md).
- **Production verification** — Deploy-scoped production canaries prove auth, generation, checkout-session creation, and scheduled live settlement. Details: [`docs/product/production-confidence.md`](docs/product/production-confidence.md).

## Tech stack

| Area | Choice |
|------|--------|
| UI | Svelte 5, SvelteKit, TypeScript, Tailwind CSS |
| Backend | Convex (queries, mutations, actions, crons, file storage) |
| Auth | Better Auth + `@convex-dev/better-auth` |
| Payments | Stripe Checkout (one-time packs), `@convex-dev/stripe` |
| Image pipeline | Vertex AI via `@google/genai` in Node actions; matting and optimization in Convex |

Deployment and operations are documented in the runbooks (frontend e.g. Vercel + Convex cloud).

## Development

```sh
pnpm install
pnpm dev
```

Runs the Vite dev server and Convex dev in parallel (both are required for sign-in: the app proxies `/api/auth/*` to Convex’s `*.convex.site` URL, not to Vite). If you only run `vite dev`, auth requests have nowhere to go. The auth proxy URL is derived from `PUBLIC_CONVEX_URL` (`https://…convex.cloud` → `https://…convex.site`) so it cannot drift; use `PUBLIC_CONVEX_SITE_URL` only when realtime uses a local Convex URL. Verify connectivity: `pnpm check:convex-auth`.

## Build & check

**Fast gate** (day-to-day): `pnpm check`, `pnpm typecheck:tsc`, `pnpm lint:ts`, `pnpm test`.

**Full repo gate** (CI parity): `pnpm verify` — adds Knip, jscpd, production `vite build`, and Playwright E2E. See [`docs/runbooks/CI-AND-CANARIES.md`](docs/runbooks/CI-AND-CANARIES.md) and [`docs/runbooks/CODEBASE-HYGIENE.md`](docs/runbooks/CODEBASE-HYGIENE.md).

```sh
pnpm build
pnpm check
```

- Vercel deployment: [`docs/runbooks/VERCEL-DEPLOYMENT.md`](docs/runbooks/VERCEL-DEPLOYMENT.md)
- Convex vs Vercel env boundaries: [`docs/runbooks/CONVEX-VERCEL-ENVIRONMENTS.md`](docs/runbooks/CONVEX-VERCEL-ENVIRONMENTS.md)
- Stripe + Convex environments: [`docs/runbooks/STRIPE-CONVEX-ENVIRONMENTS.md`](docs/runbooks/STRIPE-CONVEX-ENVIRONMENTS.md)
- Secrets management & rotation (Doppler-first): [`docs/runbooks/SECRETS-MANAGEMENT.md`](docs/runbooks/SECRETS-MANAGEMENT.md)
- CI, auth canaries, and production verification: [`docs/runbooks/CI-AND-CANARIES.md`](docs/runbooks/CI-AND-CANARIES.md)
- Knip caveats and audit commands: [`docs/runbooks/CODEBASE-HYGIENE.md`](docs/runbooks/CODEBASE-HYGIENE.md)

## Project structure

- `src/convex/` — Convex schema, auth, generations, Stripe, HTTP (webhooks), ops/analytics hooks
- `src/lib/` — Components, auth client, PostHog, analytics helpers
- `src/routes/` — SvelteKit routes (marketing, `/auth`, `/app/*`)
- `scripts/` — Utility scripts
- `docs/product/` — Shipped product behavior and architecture
- `docs/runbooks/` — Setup, deployment, verification, and operator workflows
- `docs/implementation/` — Time-bound implementation specs (prefer promoting durable material into product/runbooks/conventions)

## Useful Commands

```sh
pnpm verify
pnpm verify:production
pnpm reset-qa
```

- `pnpm verify` — Full local quality gate (Knip, dupcheck, typecheck, lint, tests, build, E2E). For a lighter loop, use the fast gate in **Build & check** above.
- `pnpm verify:production` — Production verification runner used by the live deploy gate.
- `pnpm reset-qa` — Reset the allowlisted QA account on prod so the next sign-in starts from a fresh user state. Runbook: [`docs/runbooks/QA-RESET.md`](docs/runbooks/QA-RESET.md).

## Documentation

| Doc | Purpose |
|-----|---------|
| [`docs/README.md`](docs/README.md) | Documentation retention rules and folder roles |
| [`docs/product/authentication.md`](docs/product/authentication.md) | Sign-in, sessions, protected routes |
| [`docs/product/image-generation.md`](docs/product/image-generation.md) | Pipeline, Vertex, matting, history |
| [`docs/product/payments-system.md`](docs/product/payments-system.md) | Credits, Stripe, pricing tiers |
| [`docs/product/weekly-credit-drip.md`](docs/product/weekly-credit-drip.md) | Weekly free-credit replenishment behavior |
| [`docs/product/credit-system-abuse-prevention.md`](docs/product/credit-system-abuse-prevention.md) | Credit-spend and checkout abuse controls |
| [`docs/product/observability.md`](docs/product/observability.md) | PostHog, ops events, Sentry scope |
| [`docs/product/growth-observability.md`](docs/product/growth-observability.md) | Growth-event truth classes and analytics contracts |
| [`docs/product/mcp-server.md`](docs/product/mcp-server.md) | Hosted MCP surface and optional proxy package |
| [`docs/product/production-confidence.md`](docs/product/production-confidence.md) | Deploy gate, canaries, and verification evidence |
| [`docs/runbooks/VERCEL-DEPLOYMENT.md`](docs/runbooks/VERCEL-DEPLOYMENT.md) | Frontend deployment checklist |
| [`docs/runbooks/SECRETS-MANAGEMENT.md`](docs/runbooks/SECRETS-MANAGEMENT.md) | Doppler-first source of truth, scripts, and rotation cadence |
| [`docs/runbooks/MANUAL-SECRET-ROTATION-GUIDE.md`](docs/runbooks/MANUAL-SECRET-ROTATION-GUIDE.md) | Click-paths for vendor-only rotations (Stripe, Google OAuth, Discord) |
| [`docs/runbooks/CI-AND-CANARIES.md`](docs/runbooks/CI-AND-CANARIES.md) | CI, auth smoke, and production verification |
| [`docs/runbooks/CODEBASE-HYGIENE.md`](docs/runbooks/CODEBASE-HYGIENE.md) | Local gates, Knip interpretation, audit artifacts |
| [`docs/runbooks/QA-RESET.md`](docs/runbooks/QA-RESET.md) | Resetting the allowlisted QA account on prod |
