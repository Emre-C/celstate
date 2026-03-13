# Celstate

SvelteKit + Convex app for image generation and Stripe-based credit purchases.

## Development

```sh
pnpm install
pnpm dev
```

Runs Vite dev server and Convex dev in parallel.

## Build & Deploy

```sh
pnpm build
pnpm check
```

See [`docs/implementation/PRODUCTION-DEPLOYMENT.md`](docs/implementation/PRODUCTION-DEPLOYMENT.md) for full deployment steps.

## Project structure

- `src/convex/` — Convex functions (generations, users, Stripe)
- `src/lib/` — Shared components
- `src/routes/` — SvelteKit routes
- `scripts/` — Utility scripts

## Docs

- [`docs/implementation/PRODUCTION-DEPLOYMENT.md`](docs/implementation/PRODUCTION-DEPLOYMENT.md) — Deployment master plan
