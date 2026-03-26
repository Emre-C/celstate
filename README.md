# Celstate

A focused tool for **transparent-background PNGs** from a text prompt—no background-removal step after the fact. The app is a **SvelteKit** frontend on **Convex** (realtime data, storage, scheduled work) with **Stripe** credit packs and product analytics.

Product direction and principles: [`docs/VISION.md`](docs/VISION.md).

## What it does today

- **Transparent images** — Dual-pass generation on white/black backgrounds, then **difference matting** for exact alpha (see [`docs/product/image-generation.md`](docs/product/image-generation.md)). Inference uses **Vertex AI** (Generative AI on Vertex), not the Gemini Developer API key flow.
- **Style references** — Optional reference image(s) steer palette and look; text-only mode when none are attached.
- **Credits** — Balance shown in-app; generations deduct credits; failures refund. **Sign-up bonus**, **weekly free drip**, and **one-time Stripe packs** (no subscriptions). Details: [`docs/product/payments-system.md`](docs/product/payments-system.md).
- **Auth** — **Better Auth on Convex** with a SvelteKit proxy; **Google** sign-in live; **Apple** implemented but disabled until Apple-side setup is done; **no email/password**. Server-side guards for `/app/*`. Details: [`docs/product/authentication.md`](docs/product/authentication.md).
- **Observability** — **PostHog** (client + Convex server capture), **Sentry** on the SvelteKit app, optional **ops webhooks** (e.g. Slack/Discord) for purchases and generation alerts. Convex workers do not use Sentry. Overview: [`docs/product/observability.md`](docs/product/observability.md).

## Tech stack

| Area | Choice |
|------|--------|
| UI | Svelte 5, SvelteKit, TypeScript, Tailwind CSS |
| Backend | Convex (queries, mutations, actions, crons, file storage) |
| Auth | Better Auth + `@convex-dev/better-auth` |
| Payments | Stripe Checkout (one-time packs), `@convex-dev/stripe` |
| Image pipeline | Vertex AI via `@google/genai` in Node actions; matting and optimization in Convex |

Deployment is described in the implementation docs (frontend e.g. Vercel + Convex cloud).

## Development

```sh
pnpm install
pnpm dev
```

Runs the Vite dev server and Convex dev in parallel (both are required for sign-in: the app proxies `/api/auth/*` to Convex’s `*.convex.site` URL, not to Vite). If you only run `vite dev`, auth requests have nowhere to go. The auth proxy URL is derived from `PUBLIC_CONVEX_URL` (`https://…convex.cloud` → `https://…convex.site`) so it cannot drift; use `PUBLIC_CONVEX_SITE_URL` only when realtime uses a local Convex URL. Verify connectivity: `pnpm check:convex-auth`.

## Build & check

```sh
pnpm build
pnpm check
```

- Full production steps: [`docs/implementation/PRODUCTION-DEPLOYMENT.md`](docs/implementation/PRODUCTION-DEPLOYMENT.md)
- Convex vs Vercel env boundaries: [`docs/implementation/CONVEX-VERCEL-ENVIRONMENTS.md`](docs/implementation/CONVEX-VERCEL-ENVIRONMENTS.md)
- Stripe + Convex environments: [`docs/implementation/STRIPE-CONVEX-ENVIRONMENTS.md`](docs/implementation/STRIPE-CONVEX-ENVIRONMENTS.md)

## Project structure

- `src/convex/` — Convex schema, auth, generations, Stripe, HTTP (webhooks), ops/analytics hooks
- `src/lib/` — Components, auth client, PostHog, analytics helpers
- `src/routes/` — SvelteKit routes (marketing, `/auth`, `/app/*`)
- `scripts/` — Utility scripts
- `docs/product/` — Product behavior (auth, generation, payments, observability)
- `docs/implementation/` — Setup and deployment specifics

## Documentation

| Doc | Purpose |
|-----|---------|
| [`docs/VISION.md`](docs/VISION.md) | Product vision and quality bar |
| [`docs/product/authentication.md`](docs/product/authentication.md) | Sign-in, sessions, protected routes |
| [`docs/product/image-generation.md`](docs/product/image-generation.md) | Pipeline, Vertex, matting, history |
| [`docs/product/payments-system.md`](docs/product/payments-system.md) | Credits, Stripe, pricing tiers |
| [`docs/product/observability.md`](docs/product/observability.md) | PostHog, ops events, Sentry scope |
| [`docs/implementation/PRODUCTION-DEPLOYMENT.md`](docs/implementation/PRODUCTION-DEPLOYMENT.md) | Deploy checklist |
