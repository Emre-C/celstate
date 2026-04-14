# Authentication

**Canonical product and engineering reference** for Celstate sign-in, session handling, and protected routes. Older bookmarks may point to `docs/product/AUTH.md`, which redirects here.

## Overview

Celstate uses **Better Auth on Convex** with a SvelteKit proxy layer. The deliberate product shape is:

- Only trusted social identity providers are supported.
- **`google`** — active in all environments.
- **`apple`** — fully implemented but temporarily disabled while Apple-side setup is resolved.
- **Email/password** is intentionally not offered.
- Members-only routes stay protected on the server.
- SSR and client hydration share a minimal cookie-based bootstrap contract.
- The public site must behave consistently on one canonical origin.

## Why email/password is not supported

Celstate does not want to own password storage, reset flows, breach handling, or another low-trust account surface. Google and Apple provide a tighter product surface, lower operational risk, and cleaner onboarding.

## Architecture map

### Core pieces

- `src/convex/auth.ts` — Better Auth server configuration via `@convex-dev/better-auth`. Registers Google (and Apple when re-enabled). Uses canonical `SITE_URL` as Better Auth `baseURL`. Validates canonical auth env at startup via `assertCanonicalAuthEnv()` (from `src/lib/auth/config.ts`).
- `src/convex/auth.config.ts` — Convex auth config using `getAuthConfigProvider()` from `@convex-dev/better-auth/auth-config`.
- `src/convex/http.ts` — Convex HTTP router. Registers Better Auth routes via `authComponent.registerRoutes(http, createAuth)`.
- `src/routes/api/auth/[...all]/+server.ts` — SvelteKit proxy for Better Auth requests. Resolves the Convex site URL from `PUBLIC_CONVEX_URL` (imported via `$env/static/public`; same deployment: `https://…convex.cloud` → `https://…convex.site`) or from optional `PUBLIC_CONVEX_SITE_URL` (dynamic, for when realtime uses a local URL); see `src/lib/server/convex-site-url.ts`. Delegates to `src/lib/server/auth-proxy.ts`.
- `src/lib/server/auth-proxy.ts` — Builds the Better Auth proxy request for Convex. Strips caller-controlled forwarding / IP / hop-by-hop headers and stamps trusted `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-port`, `x-forwarded-for`, `x-celstate-client-ip`, and `x-request-id` values.
- `src/lib/server/auth-alerts.ts` — SvelteKit-side auth outage alerting. Provides rate-limited Sentry + webhook alerts for auth proxy failures (immediate, 5m cooldown) and repeated auth endpoint 5xx responses (threshold of 3 in 60s, then 5m cooldown). Reuses the shared `buildAuthAlertRequest` from `src/convex/lib/ops.ts`.
- `src/lib/auth-client.ts` — Better Auth browser client via `createAuthClient` from `better-auth/svelte`. Prefers `window.location.origin` over `PUBLIC_SITE_URL` so browser auth calls stay same-origin on the live host. Includes the `convexClient()` plugin from `@convex-dev/better-auth/client/plugins`.
- `src/lib/auth/config.ts` — Canonical auth env contract: reads, validates, exports structured env values; builds social provider config, trusted origins, and provider availability. Apple credential requirements are temporarily relaxed (see Apple section).
- `src/lib/auth/providers.ts` — UI provider descriptors for `google` and `apple`. Apple is currently forced to `comingSoon: true`.
- `src/lib/auth/redirect.ts` — Shared redirect-target builder for server and client auth guards.
- `src/lib/auth/protected-app.ts` — Pure helper for protected-app auth-state UX (including grace-period behavior to reduce tab-return flicker).
- `src/lib/server/auth.ts` — Cookie helpers for SSR auth bootstrap; detects the Better Auth Convex JWT cookie; seeds initial client auth snapshot from cookie presence only.
- `src/lib/server/auth-guard.ts` — Server helpers such as `buildAuthRedirectTarget` used by the `(app)` layout guard.
- `src/lib/server/canonical-site.ts` — Resolves canonical-host redirects from `PUBLIC_SITE_URL`.
- `src/lib/server/response.ts` — Safely adds headers to immutable `Response` objects by cloning first.
- `src/routes/+layout.server.ts` — Feeds initial auth state from cookies into the root layout.
- `src/routes/+layout.svelte` — Root layout owns global app chrome and the SSR auth snapshot; does not initialize the Convex Better Auth client globally.
- `src/hooks.server.ts` — Reads Convex JWT from Better Auth cookies into `event.locals.token`; enforces canonical host; emits request-scoped auth logs for `/auth` and `/api/auth/*`.
- `src/routes/(app)/+layout.server.ts` — **Authoritative route guard**: redirects unauthenticated users to `/auth?redirectTo=...` (via `buildAuthRedirectTarget` from `auth-guard.ts`).
- `src/routes/(app)/+layout.svelte` — Protected-app client UX after hydration; initializes `createSvelteAuthClient(...)` with `PUBLIC_CONVEX_URL` from `$env/static/public`; runs `users.storeUser` bootstrap without blocking first paint; tolerates brief auth revalidation churn before redirecting.
- `src/routes/auth/+page.svelte` — Social-only sign-in surface (Google active, Apple “Coming soon”).

## Dependencies

| Package | Version | Role |
|--------|---------|------|
| `@convex-dev/better-auth` | `^0.11.1` | Convex integration for Better Auth |
| `better-auth` | `1.6.0` | Core auth framework |
| `@mmailaender/convex-better-auth-svelte` | `^0.6.2` | SvelteKit handler + Svelte client helpers |
| `@mmailaender/convex-svelte` | `^0.17.0` | Convex Svelte client |
| `convex` | `^1.33.1` | Core Convex client |

## Request flow

### Sign-in

1. User visits `/auth`.
2. The page calls `authClient.signIn.social(...)` for Google.
3. SvelteKit proxies Better Auth through `/api/auth/[...all]` to the resolved Convex site URL (`PUBLIC_CONVEX_URL` via `$env/static/public` → derived `*.convex.site`, or explicit `PUBLIC_CONVEX_SITE_URL` for local realtime).
4. `auth-proxy.ts` strips any caller-controlled proxy headers and forwards the trusted public host / protocol / port / client-IP metadata that Better Auth is allowed to trust.
5. Better Auth completes the provider flow and writes the session cookies plus the Convex JWT cookie.
6. SSR reads the Convex JWT cookie to derive initial auth state.
7. The root layout passes the SSR auth snapshot down; the protected app layout initializes `createSvelteAuthClient(...)` with `PUBLIC_CONVEX_URL` (via `$env/static/public`).
8. Client hydration exchanges the Better Auth session for Convex auth state and initializes the protected shell.

### Protected routes (`/app/*`)

1. User requests a route under `(app)` (e.g. `/app`).
2. `hooks.server.ts` exposes the JWT from cookies as `locals.token`.
3. `(app)/+layout.server.ts` redirects unauthenticated users to `/auth?redirectTo=...`.
4. `(app)/+layout.svelte` manages post-hydration UX and must not eagerly override the server guard during transient client revalidation.
5. The shell renders when the user is effectively authenticated; `users.storeUser` continues in the background.
6. After sign-in, the user returns to the original route.

## Cookies and SSR

Server-side bootstrap depends on Better Auth’s Convex JWT cookie contract. Cookie candidates (in order):

- `better-auth.convex_jwt`
- `__Secure-better-auth.convex_jwt`

SSR uses **cookie presence only** to derive the initial snapshot. Full validation remains with Better Auth + Convex after hydration.

## Enduring lessons

1. **One canonical public origin** — `SITE_URL` and `PUBLIC_SITE_URL` must resolve to the same host. The SvelteKit hook redirects non-canonical requests. OAuth must start and finish on the same origin or state cookies drift. The marketing landing (`src/routes/(marketing)/+page.svelte`) builds `rel=canonical`, `og:url`, and absolute `og:image` URLs from `PUBLIC_SITE_URL` so crawlers and social previews align with that host; `pnpm check:public-env` enforces an origin-only `PUBLIC_SITE_URL` (see [PUBLIC-ENV-CHECKLIST.md](../runbooks/PUBLIC-ENV-CHECKLIST.md)).
2. **Browser auth client** — Prefer `window.location.origin` over `PUBLIC_SITE_URL` in `auth-client.ts` so `/api/auth/*` stays same-origin for the host the user loaded.
3. **Proxy headers** — Never forward caller-supplied proxy / IP headers into Better Auth. Strip them in SvelteKit and stamp the trusted values yourself: `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-port`, `x-forwarded-for`, dedicated internal client-IP header `x-celstate-client-ip`, and `x-request-id`.
4. **Immutable responses in hooks** — Do not mutate headers on arbitrary `Response` objects; use `response.ts` when adding headers.
5. **Server vs client** — `+layout.server.ts` is the source of truth for route protection; the client layout smooths transient churn, not authorization.
6. **SSR snapshot** — UX seed only; session authority is Better Auth + Convex after hydration.
7. **Non-blocking user sync** — `users.storeUser` is app data, not authz. `/app` must not wait for the user row; queries must tolerate a short window without row data.
8. **Scope bootstrap** — Avoid initializing the Convex Better Auth bridge globally on public pages; keep it explicit in `(app)`.
9. **Explicit Convex URL** — Pass `PUBLIC_CONVEX_URL` into `createSvelteAuthClient(...)` explicitly via `$env/static/public`.
10. **Dev vs prod Convex** — `PUBLIC_CONVEX_URL` is the realtime target; `PUBLIC_CONVEX_SITE_URL` is the Better Auth HTTP actions target when realtime is local. The two may differ by hostname class (`convex.cloud` vs `convex.site` or loopback vs `convex.site`), but they must always refer to the **same logical deployment**.

## Observability

This section describes **auth-route visibility on the SvelteKit server**, not the full product observability stack (PostHog, Convex-side capture, ops webhooks). For that partition, see [`docs/product/observability.md`](observability.md).

### Console logging

Structured **console** logging lives in `src/hooks.server.ts` (JSON lines with `scope: "auth"`). A request is observed when the path is `/auth`, starts with `/api/auth`, **or** the URL has an `error` query parameter (so OAuth failures on redirects are captured even off those paths). Events include `request_started`, `request_finished`, and `request_failed`; payloads include request ID, method, host, pathname, origin/referer where relevant, `hasAuthToken` (Convex JWT from cookies), response status, redirect location summary, and URL `error` when present.

### Auth outage alerting

Rate-limited alerting fires through both **Sentry** and the **ops webhook** (`OPS_ALERT_WEBHOOK_URL`). Alerting uses a stricter predicate than logging — only `/auth` and `/api/auth/*` paths trigger alerts (not arbitrary URLs with `?error=`).

| Signal | Trigger | Sentry | Webhook |
|--------|---------|--------|---------|
| `auth_proxy_failure` | Auth proxy exhausts retries | ✓ | ✓ (5m cooldown per path) |
| `auth_endpoint_5xx` | ≥3 auth 5xx in 60s | ✓ | ✓ (5m cooldown per path+status) |
| `better_auth_api_error` | Better Auth `onAPIError` fires | — | ✓ (5m cooldown, Convex-side) |

Rate-limit state is **process-local** (in-memory map on SvelteKit, module variable on Convex). It is not durable across cold starts or multiple instances. Sentry's global `handleErrorWithSentry()` separately captures unhandled exceptions thrown from auth routes.

### Sentry boundary

The same hook chain wraps **`@sentry/sveltekit`** (`Sentry.sentryHandle()` and `handleErrorWithSentry()`), so unhandled errors and Sentry's own instrumentation are separate from the auth-scoped console logs. Convex-side auth code does **not** import Sentry (per the `invariant_convex_sentry` rule).

Auth-route console logging does not fully diagnose **client-only** flicker inside an already-loaded `/app` tab; pair server logs with browser automation or temporary client instrumentation in the protected layout when debugging UX regressions.

## Regression coverage

Relevant tests:

- `src/lib/auth-client.test.ts`
- `src/lib/auth/config.test.ts`
- `src/lib/auth/protected-app.test.ts`
- `src/lib/server/auth-alerts.test.ts`
- `src/lib/server/auth-guard.test.ts`
- `src/lib/server/auth-proxy.test.ts`
- `src/lib/server/auth.test.ts`
- `src/lib/server/canonical-site.test.ts`
- `src/lib/server/response.test.ts`

CI runs these as a dedicated **auth regression suite** (`pnpm test:auth`) first, then the full **`pnpm verify`** pipeline (typecheck, Knip, duplication check, ESLint, all Vitest tests, production build, **`pnpm test:e2e`** Playwright smoke on the marketing landing page—including a console guard for Svelte **`hydration_mismatch`**). The test list is maintained in `package.json` under the `test:auth` script (includes `scripts/auth-canary-probe.test.ts` for the scheduled auth canary get-session contract). See `docs/runbooks/CI-AND-CANARIES.md`.

### Scheduled auth canary

A GitHub Actions workflow (`.github/workflows/auth-canary.yml`) runs every **15 minutes** and can also be triggered manually. It executes `scripts/check-auth-health.mjs`, which:

- Verifies `/auth` renders the expected sign-in UI (checks stable `data-testid` markers, not copy text).
- Verifies `/api/auth/get-session` returns valid JSON with a **final** **200** or **401** after **following redirects** (default `fetch` behavior). Apex → `www` **308** redirects must not be treated as the final response; use the canonical production origin in `AUTH_CANARY_BASE_URL` when possible (see `docs/runbooks/CI-AND-CANARIES.md`).
- Posts failures to the ops webhook.

This is a **smoke check** — it validates page availability and session endpoint health, not full OAuth redirect/callback flows.

**GitHub Actions secrets** (not `.env` on your machine): `AUTH_CANARY_BASE_URL` (production origin), `OPS_ALERT_WEBHOOK_URL`, and optionally `OPS_ALERT_WEBHOOK_KIND`.

The get-session status contract is shared with tests in `scripts/auth-canary-probe.mjs` / `scripts/auth-canary-probe.test.ts`.

### Production verification (deploy gate)

Separately from the smoke workflow above, **`scripts/production-verification.ts`** (GitHub Actions: `.github/workflows/production-verification.yml`) proves **authenticated protected-route reachability** for production using Playwright and a pre-generated storage state (`AUTH_CANARY_STORAGE_JSON`). That satisfies the **AUTH** domain’s `protectedRouteReachable` evidence for **POST_DEPLOY** and **SCHEDULED** triggers by default (opt-out via `AUTH_CANARY_REQUIRE_PROTECTED_ROUTE=false`). It does **not** replace a full end-to-end OAuth redirect/callback test in CI.

Formal contract, other domains (generation, checkout, live settlement), and persistence: [`docs/implementation/PRODUCTION-CONFIDENCE-FORMAL-SPEC.md`](../implementation/PRODUCTION-CONFIDENCE-FORMAL-SPEC.md).

Additional areas still worth covering over time: full OAuth redirect/callback automation, protected-route **hydration** edge cases after social login, first authenticated render when the Convex user row does not exist yet, and env selection when switching between cloud dev and local Convex.

## Environment variables

### Convex / Better Auth (server)

Required by `src/convex/auth.ts`:
- `SITE_URL` — Canonical site origin (must match what you serve; wrong host breaks `trustedOrigins` and OAuth redirects).
- `BETTER_AUTH_SECRET` — Better Auth signing secret.
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google OAuth.

When Apple is re-enabled:
- `AUTH_APPLE_ID`, `AUTH_APPLE_SECRET`
- Optional: `AUTH_APPLE_APP_BUNDLE_IDENTIFIER`

Legacy names such as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are intentionally ignored.

### Public (web app)

- `PUBLIC_CONVEX_URL` — Convex deployment URL (realtime client). When this is `https://<deployment>.convex.cloud`, the auth proxy uses `https://<deployment>.convex.site` automatically (same deployment; no duplicate config).
- `PUBLIC_CONVEX_SITE_URL` — Optional. Only needed when `PUBLIC_CONVEX_URL` is a **local** Convex URL (e.g. `http://127.0.0.1:3210`) but Better Auth still runs on the cloud site URL; must be the `https://…convex.site` for the **same** logical deployment. If set while `PUBLIC_CONVEX_URL` is a cloud URL, it must match the derived `…convex.site` or startup fails (prevents drift).
- `PUBLIC_SITE_URL` — Canonical public site origin.

### Local development

- `PUBLIC_SITE_URL` should match the dev server (e.g. `http://localhost:5173`).
- Convex **dev** deployment `SITE_URL` should match that origin so `trustedOrigins` includes your dev origin. Production keeps its own canonical `SITE_URL`.
- `PUBLIC_CONVEX_URL` may point to cloud dev or local Convex (e.g. `http://127.0.0.1:3210`). If it is local, set `PUBLIC_CONVEX_SITE_URL` to the **same** deployment’s origin-only `https://…convex.site` (the app cannot derive it from a loopback URL). If it is `https://…convex.cloud`, the site URL is derived and `PUBLIC_CONVEX_SITE_URL` is optional.

**Do not disable auth in dev** — cookies, redirects, and Convex identity should always be exercised. Use the development Convex deployment and test OAuth credentials.

**Dev vs prod isolation** — Separate Convex deployments and env stores; `pnpm exec convex env set` defaults to dev (`--prod` for production). Local `.env` uses dev URLs; production builds use prod URLs. Google Cloud Console can list both localhost and production origins on the same OAuth client.

See also: [`docs/implementation/STRIPE-CONVEX-ENVIRONMENTS.md`](../../implementation/STRIPE-CONVEX-ENVIRONMENTS.md) (same dev/prod split pattern for Stripe).

**Known operational note:** Convex local deployment on Windows has shown upstream path issues (`InvalidExternalModules` with duplicated drive-letter paths). Treat local Convex switching as an operational validation separate from auth code changes.

## Apple Sign-In

### Status

Implemented but temporarily disabled (config, server registration, UI, env parsing). Paused for Apple-side issues, not missing implementation.

### What to change to re-enable

Locations are marked with `TODO:` in:

- `src/lib/auth/providers.ts`
- `src/lib/auth/config.ts`
- `src/lib/auth/config.test.ts`
- `src/routes/auth/+page.svelte`

### Re-enable checklist

1. Set `AUTH_APPLE_ID` and `AUTH_APPLE_SECRET` on the target Convex deployment.
2. Revert the `TODO:` blocks above.
3. Run `pnpm test` and `pnpm check`.
4. Deploy Convex (`pnpm exec convex deploy --yes`), then deploy the frontend (e.g. `pnpm exec vercel --prod`).

## Operations

### Rotating secrets

1. Update Convex (and local) env as needed.
2. Restart dev servers.
3. Run `pnpm test` and `pnpm check`.
4. Verify `/auth`, Google handoff, and protected `/app` tab-return in the browser.

### Deploying

- Convex: `pnpm exec convex deploy --yes` (non-interactive; adjust for your pipeline).
- Vercel: `pnpm exec vercel --prod`.

Convex env: `pnpm exec convex env set KEY VALUE` (add `--prod` for production). Vercel env: `pnpm exec vercel env add KEY production --value VALUE --yes`.

## Future hardening (non-blocking)

1. E2E auth automation: full sign-in, callback, sign-out, tab-return in CI (production verification already proves **protected-route entry** with a stored session; it does not drive OAuth end-to-end).
2. Optional structured client metrics for protected-app churn and `users.storeUser` latency when debugging.
3. Explicit tests for non-blocking user bootstrap (render before `users.storeUser` completes; graceful degradation until user row exists).
4. Revisit local Convex on Windows after upstream fixes.
5. Release checklist: canonical origin, same-origin `/api/auth`, protected routes, callbacks, no redirect loops on apex vs `www` if aliases exist.
6. Richer failure taxonomy for callbacks, proxy errors, cookie bootstrap, and client churn.

### Adding another provider later

1. Extend `src/lib/auth/config.ts` (env + `buildSocialProviders()`).
2. Extend `src/lib/auth/providers.ts`.
3. Add regression tests.
4. Update this document.

## Sign out

Signing out clears the Better Auth session through the same-origin auth client and returns the user to the public experience.

## Intentionally out of scope

- Email/password authentication
- Password reset flows
- Magic links
- Anonymous sessions
- Native Apple ID token flows without additional mobile-specific setup
