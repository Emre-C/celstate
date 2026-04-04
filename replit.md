# Celstate — Replit Environment

## Project Overview

Celstate is a SvelteKit web application for generating transparent-background PNG images from text prompts using AI (Vertex AI). It uses a "difference matting" technique (generating on white/black backgrounds) to derive exact alpha channels.

## Tech Stack

- **Frontend**: Svelte 5 + SvelteKit, Tailwind CSS 4
- **Backend**: Convex (realtime DB, actions, crons, file storage)
- **Auth**: Better Auth + `@convex-dev/better-auth` (Google sign-in)
- **AI**: Vertex AI via `@google/genai`
- **Payments**: Stripe (one-time credit packs)
- **Observability**: PostHog (analytics), Sentry (error tracking)
- **Package Manager**: pnpm (but npm install is used in Replit due to environment constraints)

## Running in Development

The dev workflow runs just the Vite server (port 5000). Full dev also requires a running Convex deployment.

**Workflow**: `Start application`
- Command: `node_modules/.bin/vite dev --host 0.0.0.0 --port 5000`
- Port: 5000 (webview)

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:
- `PUBLIC_SITE_URL` — The app's canonical URL (set to Replit dev domain in dev)
- `PUBLIC_CONVEX_URL` — Your Convex deployment URL (`https://<name>.convex.cloud`)
- `PUBLIC_POSTHOG_KEY` — PostHog key (optional, leave empty to disable)

## Key Files

- `vite.config.ts` — Vite config; server listens on `0.0.0.0:5000` with `allowedHosts: true`
- `src/hooks.server.ts` — SvelteKit hooks; canonical redirect is disabled in dev mode
- `src/convex/` — Convex backend functions (schema, auth, generations, Stripe)
- `src/routes/` — SvelteKit pages and API routes
- `src/lib/` — Shared components and utilities
- `convex.json` — Convex config (`functions` dir = `src/convex/`)

## Deployment Notes

- Build: `npm run build`
- Run: `node build/index.js`
- Target: autoscale
- The Vercel adapter is installed; for Replit deployment the build output at `build/` is used as a Node.js server.
- Production requires all env vars to be set (especially `PUBLIC_CONVEX_URL` and `PUBLIC_SITE_URL`).

## Replit-Specific Changes

1. `vite.config.ts`: Added `server.host = '0.0.0.0'`, `server.port = 5000`, `server.allowedHosts = true`
2. `src/hooks.server.ts`: Canonical redirect (`308`) is disabled in dev mode to prevent redirect loops through the Replit proxy
3. Dependencies installed with `npm install` (pnpm has installation issues in the Replit sandbox)

## Recent Bug Fixes & Optimizations (2026-04-04)

- **Auth state hydration fix**: `(app)/+layout.server.ts` now passes `authState` to the client layout, fixing undefined auth seed and potential redirect loops
- **Sentry trace sampling**: Reduced from 100% to 10% to control production observability costs
- **Generation history pagination**: `getByUserWithUrls` now uses `.take(50)` instead of `.collect()` to prevent unbounded payload growth
- **Matte algorithm optimization**: Merged two-pass pixel processing into a single pass for better CPU/memory efficiency
- **PNG encoding parallelization**: `finalizePipeline` now encodes white/black/final PNGs concurrently with `Promise.all`
- **Credit refund idempotency**: Added re-read guard before refund to prevent double-credit scenarios
- **Scaling docs**: Added `docs/implementation/weekly-credit-grant-at-scale.md` for future `grantWeeklyCredit` pagination plan
