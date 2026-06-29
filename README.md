# Celstate

A focused tool for **transparent-background PNGs** from a text prompt—no background-removal step after the fact. The app is a **SvelteKit** frontend on **Convex** (realtime data, storage, scheduled work) with **Stripe** credit packs and product analytics.

Feature documentation lives in [`docs/features/`](docs/features/) (structured YAML); the founder-readable vision is [`docs/product/vision.html`](docs/product/vision.html); deployment and operations runbooks live in [`docs/runbooks/`](docs/runbooks/). Documentation retention rules live in [`docs/README.md`](docs/README.md).

## What it does today

- **Transparent images** — Dual-pass generation on white/black backgrounds, then **difference matting** for exact alpha (see [`docs/features/image-generation.yaml`](docs/features/image-generation.yaml)). Inference uses **Vertex AI** (Generative AI on Vertex), not the Gemini Developer API key flow.
- **Style references** — Optional reference image(s) steer palette and look; text-only mode when none are attached.
- **Credits** — Balance shown in-app; generations deduct credits; failures refund. **Sign-up bonus**, **weekly free drip**, and **one-time Stripe packs** (no subscriptions). Details: [`docs/features/credits-and-payments.yaml`](docs/features/credits-and-payments.yaml).
- **Auth** — **Clerk** (SvelteKit) + Convex JWT; **Google** (and **Apple** when enabled in Clerk); **no email/password**. Details: [`docs/features/authentication.yaml`](docs/features/authentication.yaml).
- **Agent access** — Celstate ships a hosted **remote MCP server** plus an optional local proxy package for enterprise networking or local URL needs. Details: [`docs/features/mcp-server.yaml`](docs/features/mcp-server.yaml).
- **Observability** — **PostHog** (client + Convex server capture), **Sentry** on the SvelteKit app, optional **ops webhooks** (e.g. Slack/Discord) for purchases and generation alerts. Convex workers do not use Sentry. Overview: [`docs/features/observability.yaml`](docs/features/observability.yaml).
- **Production verification** — Deploy-scoped production canaries prove auth, generation, checkout-session creation, and scheduled live settlement. Details: [`docs/features/production-confidence.yaml`](docs/features/production-confidence.yaml).

## Tech stack

| Area | Choice |
|------|--------|
| UI | Svelte 5, SvelteKit, TypeScript, Tailwind CSS |
| Backend | Convex (queries, mutations, actions, crons, file storage) |
| Auth | Clerk + Convex JWT |
| Payments | Stripe Checkout (one-time packs), `@convex-dev/stripe` |
| Image pipeline | Vertex AI via `@google/genai` in Node actions; matting and optimization in Convex |

Deployment and operations are documented in the runbooks (frontend e.g. Vercel + Convex cloud).

## Development

```sh
pnpm install
pnpm dev
```

Runs the Vite dev server and Convex dev in parallel. Configure **Clerk** in `.env.local` or `doppler run` (`CLERK_*`, `PUBLIC_CLERK_*`); after adding Clerk to Doppler, run **`pnpm secrets:sync:convex:dev`** once so your **dev** Convex deployment has `CLERK_JWT_ISSUER_DOMAIN` (required for `auth.config.ts` to bundle). Verify: `pnpm check:kit-server-env`, `pnpm check:public-env`, and (with the app up) `pnpm check:convex-auth` for `/api/auth/session`.

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
- `docs/features/` — Structured feature state (YAML): purpose, implementation, decisions, remaining work
- `docs/product/` — Founder-readable vision (HTML) and canonical design system reference
- `docs/runbooks/` — Setup, deployment, verification, and operator workflows
- `docs/implementation/` — Time-bound implementation specs (prefer promoting durable material into features/runbooks/conventions)
- `docs/archive/` — Superseded docs retained for historical reference

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
| [`docs/product/vision.html`](docs/product/vision.html) | Founder-readable product vision and status overview |
| [`docs/product/design-system.md`](docs/product/design-system.md) | Canonical design system tokens and component rules |
| [`docs/features/authentication.yaml`](docs/features/authentication.yaml) | Auth: Clerk, sessions, protected routes |
| [`docs/features/image-generation.yaml`](docs/features/image-generation.yaml) | Generation pipeline, Vertex, matting, QA |
| [`docs/features/credits-and-payments.yaml`](docs/features/credits-and-payments.yaml) | Credits, Stripe, pricing, abuse prevention |
| [`docs/features/observability.yaml`](docs/features/observability.yaml) | PostHog, ops events, Sentry scope, growth tooling |
| [`docs/features/mcp-server.yaml`](docs/features/mcp-server.yaml) | Hosted MCP surface and optional proxy package |
| [`docs/features/production-confidence.yaml`](docs/features/production-confidence.yaml) | Deploy gate, canaries, and verification evidence |
| [`docs/features/lottie-generation.yaml`](docs/features/lottie-generation.yaml) | Lottie animation generation V1 |
| [`docs/features/marketing-landing.yaml`](docs/features/marketing-landing.yaml) | Marketing landing page |
| [`docs/registers/defects.yaml`](docs/registers/defects.yaml) | Known bugs, defects, tech debt, and product gaps |
| [`docs/runbooks/VERCEL-DEPLOYMENT.md`](docs/runbooks/VERCEL-DEPLOYMENT.md) | Frontend deployment checklist |
| [`docs/runbooks/SECRETS-MANAGEMENT.md`](docs/runbooks/SECRETS-MANAGEMENT.md) | Doppler-first source of truth, scripts, and rotation cadence |
| [`docs/runbooks/MANUAL-SECRET-ROTATION-GUIDE.md`](docs/runbooks/MANUAL-SECRET-ROTATION-GUIDE.md) | Click-paths for vendor-only rotations (Stripe, Google OAuth, Discord) |
| [`docs/runbooks/CI-AND-CANARIES.md`](docs/runbooks/CI-AND-CANARIES.md) | CI, auth smoke, and production verification |
| [`docs/runbooks/CODEBASE-HYGIENE.md`](docs/runbooks/CODEBASE-HYGIENE.md) | Local gates, Knip interpretation, audit artifacts |
| [`docs/runbooks/QA-RESET.md`](docs/runbooks/QA-RESET.md) | Resetting the allowlisted QA account on prod |
