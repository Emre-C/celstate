# Celstate Authentication

## Goals

Celstate uses a narrow, deliberate authentication model:

- Only trusted social identity providers are supported.
- Email/password authentication is intentionally not offered.
- Members-only routes stay protected on the server.
- SSR and client hydration share a minimal cookie-based bootstrap contract.
- The public site must behave consistently on one canonical origin.

## Supported providers

Celstate supports exactly these providers:

- `google` — **Active.** Available in all environments.
- `apple` — **Coming soon.** Fully implemented but temporarily disabled while Apple resolves setup issues on their side.

> **TODO:** Apple Sign-In is fully wired — config, server logic, UI, and env parsing are all intact. To re-enable it, search the codebase for `TODO:` comments referencing Apple and remove the temporary overrides. See the "Re-enabling Apple Sign-In" section below.

Email/password sign-up and sign-in are out of scope.

## Why email/password is not supported

Celstate does not want to own password storage, reset flows, breach handling, or another low-trust account surface. Google and Apple provide a tighter product surface, lower operational risk, and cleaner onboarding.

## Architecture map

### Core pieces

- `src/convex/auth.ts`
  - Better Auth server configuration running on Convex via `@convex-dev/better-auth`.
  - Registers Google (and Apple when available) as the only social providers.
  - Uses the canonical `SITE_URL` as Better Auth's `baseURL`.
  - Validates canonical auth env vars at startup via `assertCanonicalAuthEnv()`.

- `src/convex/auth.config.ts`
  - Convex auth config using `getAuthConfigProvider()` from `@convex-dev/better-auth/auth-config`.

- `src/convex/http.ts`
  - Convex HTTP router. Registers Better Auth routes via `authComponent.registerRoutes(http, createAuth)`.

- `src/routes/api/auth/[...all]/+server.ts`
  - SvelteKit proxy route for Better Auth requests.
  - Requires `PUBLIC_CONVEX_SITE_URL` explicitly.
  - Delegates to `src/lib/server/auth-proxy.ts`.

- `src/lib/server/auth-proxy.ts`
  - Builds the Better Auth proxy request for Convex.
  - Preserves `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-port`, and `x-request-id`.

- `src/lib/auth-client.ts`
  - Better Auth browser client via `createAuthClient` from `better-auth/svelte`.
  - Prefers `window.location.origin` over `PUBLIC_SITE_URL` so browser auth calls stay same-origin on the live host.
  - Includes the `convexClient()` plugin from `@convex-dev/better-auth/client/plugins`.

- `src/lib/auth/config.ts`
  - Canonical auth env var contract. Reads, validates, and exports structured env values.
  - Builds social provider config, trusted origins, and provider availability.
  - Apple credential requirements are temporarily commented out.

- `src/lib/auth/providers.ts`
  - UI provider descriptors for `google` and `apple`.
  - Apple is currently forced to `comingSoon: true`.

- `src/lib/auth/redirect.ts`
  - Shared redirect-target builder used by both server and client auth guards.

- `src/lib/auth/protected-app.ts`
  - Pure helper for protected-app auth-state UX decisions.
  - Encodes the grace-period behavior that prevents tab-return flicker.

- `src/lib/server/auth.ts`
  - Shared cookie helpers for SSR auth bootstrap.
  - Detects the Better Auth Convex JWT cookie.
  - Seeds the initial client auth snapshot from cookie presence only.

- `src/lib/server/canonical-site.ts`
  - Resolves canonical-host redirects from `PUBLIC_SITE_URL`.
  - Builds redirect responses without mutating immutable redirect headers.

- `src/lib/server/response.ts`
  - Safely adds headers to immutable `Response` objects by cloning them first.

- `src/routes/+layout.server.ts`
  - Feeds initial auth state from cookies into the root layout.

- `src/routes/+layout.svelte`
  - Passes the SSR auth snapshot into `createSvelteAuthClient(...)`.
  - Prevents the initial hydration loading flash.

- `src/hooks.server.ts`
  - Extracts the Convex auth token from Better Auth cookies and stores it in `event.locals.token`.
  - Enforces the canonical host.
  - Emits request-scoped auth logs for `/auth` and `/api/auth/*`.

- `src/routes/(app)/+layout.server.ts`
  - Protects members-only routes with a server redirect to `/auth?redirectTo=...`.
  - This is the authoritative route guard.

- `src/routes/(app)/+layout.svelte`
  - Owns the protected-app client UX after hydration.
  - Starts the `users.storeUser` bootstrap.
  - Preserves the current workspace during brief auth revalidation churn and only redirects after a short confirmed unauthenticated window.

- `src/routes/auth/+page.svelte`
  - Social-only sign-in surface.
  - Shows Google as active and Apple as "Coming soon".

## Dependencies

| Package | Version | Role |
|---|---|---|
| `@convex-dev/better-auth` | `^0.11.1` | Convex integration for Better Auth |
| `better-auth` | `1.5.5` | Core auth framework |
| `@mmailaender/convex-better-auth-svelte` | `^0.6.2` | SvelteKit handler + Svelte client helpers |
| `@mmailaender/convex-svelte` | `^0.17.0` | Convex Svelte client |
| `convex` | `^1.32.0` | Core Convex client |

## Request flow

### Sign-in flow

1. A user visits `/auth`.
2. The auth page calls `authClient.signIn.social(...)` for Google.
3. SvelteKit proxies the Better Auth request through `/api/auth/[...all]` to Convex using `PUBLIC_CONVEX_SITE_URL`.
4. `src/lib/server/auth-proxy.ts` forwards the original browser host/protocol headers to Convex so Better Auth resolves callbacks against the real public origin.
5. Better Auth completes the provider flow and writes the Better Auth session cookie plus the Convex JWT cookie.
6. SSR reads the Better Auth Convex JWT cookie to derive initial auth state.
7. The root layout passes that SSR auth snapshot into `createSvelteAuthClient(...)`.
8. Client hydration exchanges the Better Auth session for Convex auth state and initializes the app shell.

### Protected route flow

1. A user requests `/app` or another route in the `(app)` group.
2. `src/hooks.server.ts` reads the Better Auth Convex JWT cookie.
3. `src/routes/(app)/+layout.server.ts` redirects unauthenticated users to `/auth?redirectTo=...`.
4. `src/routes/(app)/+layout.svelte` only manages post-hydration UX and must not eagerly override the server guard during transient client revalidation.
5. After successful sign-in, the auth page returns the user to the original route.

## Cookies and SSR

The current server-side bootstrap only depends on Better Auth's Convex JWT cookie contract.

Cookie candidates checked in order:

- `better-auth.convex_jwt`
- `__Secure-better-auth.convex_jwt`

SSR uses cookie presence only to derive the initial auth state. Full auth validation still happens through the Better Auth + Convex client integration after hydration.

## Enduring lessons

1. Pick one canonical public origin and enforce it everywhere.
   - `SITE_URL` and `PUBLIC_SITE_URL` must resolve to the same canonical host.
   - The SvelteKit hook must redirect every non-canonical request to that origin.
   - OAuth must start and finish on the same origin or state cookies will drift.

2. The browser auth client must prefer the live browser origin.
   - `src/lib/auth-client.ts` must prefer `window.location.origin` over `PUBLIC_SITE_URL`.
   - This keeps `/api/auth/*` same-origin for the host the user actually loaded.

3. Forward the real public host metadata through the Better Auth proxy.
   - `x-forwarded-host`
   - `x-forwarded-proto`
   - `x-forwarded-port`
   - `x-request-id`

4. Never mutate headers on arbitrary `Response` objects in `hooks.server.ts`.
   - `Response.redirect(...)` can be immutable.
   - `fetch(...)` responses can also be immutable.
   - Use `src/lib/server/response.ts` when a hook must add headers.

5. Keep server authorization and client auth UX separate.
   - The server `(app)` layout remains the source of truth for route protection.
   - The client `(app)` layout should smooth over brief auth-state churn, not bounce the user through `/auth` during transient revalidation.

6. Treat the SSR auth snapshot as a UX seed, not as the final session authority.
   - Cookie presence is enough to prevent hydration flashes.
   - Full session validation still belongs to Better Auth + Convex after hydration.

## Observability

Current server-side auth observability lives in `src/hooks.server.ts`.

It currently tells us:

- when `/auth` and `/api/auth/*` requests start and finish
- whether the server saw an auth cookie for that request
- the request ID
- redirect targets
- request failures

This was enough to diagnose the production callback, canonical-host, and immutable-response failures because those bugs crossed the server boundary.

It is not enough by itself to fully diagnose a client-only flicker inside an already loaded `/app` tab. The tab-return issue is mostly a client-state transition problem, so the server logs only help indirectly by proving the auth endpoints themselves are healthy.

When diagnosing protected-app UX regressions, use both:

- server auth request logs from `src/hooks.server.ts`
- browser automation or temporary client-side instrumentation in the protected app layout

## Regression coverage

The auth regression suite should always cover:

- canonical host redirect behavior
- auth client same-origin base URL resolution
- Better Auth proxy forwarded headers
- cookie-based SSR auth bootstrap
- immutable response header handling in hooks
- protected app auth-state stabilization during client revalidation

Relevant tests:

- `src/lib/auth-client.test.ts`
- `src/lib/auth/protected-app.test.ts`
- `src/lib/server/auth-guard.test.ts`
- `src/lib/server/auth-proxy.test.ts`
- `src/lib/server/auth.test.ts`
- `src/lib/server/canonical-site.test.ts`
- `src/lib/server/response.test.ts`

## Environment variable contract

### Convex / Better Auth server env vars

These variables are required by `src/convex/auth.ts`:

**Always required:**

- `SITE_URL` — Canonical site origin
- `BETTER_AUTH_SECRET` — Better Auth signing secret
- `AUTH_GOOGLE_ID` — Google OAuth client ID
- `AUTH_GOOGLE_SECRET` — Google OAuth client secret

**Required when Apple is re-enabled:**

- `AUTH_APPLE_ID`
- `AUTH_APPLE_SECRET`

Optional:

- `AUTH_APPLE_APP_BUNDLE_IDENTIFIER`

Legacy duplicate names such as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are intentionally ignored.

### Public env vars

These variables must be set in the web app environment:

- `PUBLIC_CONVEX_URL` — Convex deployment URL
- `PUBLIC_CONVEX_SITE_URL` — Convex HTTP actions URL
- `PUBLIC_SITE_URL` — Canonical public site origin

## Apple Sign-In — current status and re-enablement

### Current status

Apple Sign-In is fully implemented but temporarily disabled. The auth config, server-side social provider registration, UI components, and environment variable parsing are all intact. Apple was paused due to issues on Apple's side, not due to incomplete implementation.

### What was changed to disable Apple

All changes are marked with `TODO:` comments for easy discovery. The exact locations:

1. `src/lib/auth/providers.ts`
2. `src/lib/auth/config.ts`
3. `src/lib/auth/config.test.ts`
4. `src/routes/auth/+page.svelte`

### Re-enabling Apple

1. Set `AUTH_APPLE_ID` and `AUTH_APPLE_SECRET` in the production Convex environment.
2. Search the codebase for `TODO:` comments referencing Apple and revert each one.
3. Run `pnpm test` and `pnpm check`.
4. Deploy Convex with `pnpm exec convex deploy --yes`.
5. Deploy Vercel with `pnpm exec vercel --prod`.

## Operations checklist

### Rotating secrets

When rotating auth secrets or provider credentials:

1. Update the relevant Convex deployment environment variables.
2. Update local development env files if needed.
3. Restart local dev servers.
4. Re-run `pnpm test` and `pnpm check`.
5. Verify `/auth`, the Google handoff, and a protected `/app` tab-return flow in the browser.

### Deploying to production

1. Deploy Convex with `pnpm exec convex deploy --yes`.
2. Deploy Vercel with `pnpm exec vercel --prod`.

Convex env vars are managed via `pnpm exec convex env set KEY VALUE --prod`.
Vercel env vars are managed via `pnpm exec vercel env add KEY production --value VALUE --yes`.

### Adding another provider later

If Celstate adds another provider in the future:

1. Extend `src/lib/auth/config.ts` with canonical env parsing and validation.
2. Extend `buildSocialProviders()` in `src/lib/auth/config.ts`.
3. Extend `src/lib/auth/providers.ts` UI descriptors.
4. Add regression tests for env validation and runtime behavior.
5. Update this document.

## Intentionally out of scope

These are not part of the active auth system:

- Email/password authentication
- Password reset flows
- Magic links
- Anonymous sessions
- Native Apple ID token flows without additional mobile-specific setup
