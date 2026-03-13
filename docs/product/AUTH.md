# Celstate Authentication

## Goals

Celstate uses a narrow, deliberate authentication model:

- Only trusted social identity providers are supported.
- Email/password authentication is intentionally not offered.
- Members-only routes stay protected on the server.
- SSR and client hydration share a single cookie-based auth contract.

## Supported providers

Celstate supports exactly these providers:

- `google`
- `apple`

Email/password sign-up and sign-in are out of scope.

## Why email/password is not supported

Celstate does not want to own password storage, reset flows, breach handling, or another low-trust account surface. Google and Apple provide a tighter product surface, lower operational risk, and cleaner onboarding.

## Architecture map

### Core pieces

- `src/convex/auth.ts`
  - Better Auth server configuration running on Convex.
  - Registers Google and Apple as the only providers.
  - Validates canonical auth env vars at startup.

- `src/routes/api/auth/[...all]/+server.ts`
  - SvelteKit proxy route for Better Auth requests.
  - Requires `PUBLIC_CONVEX_SITE_URL` explicitly.

- `src/lib/auth-client.ts`
  - Better Auth browser client.
  - Uses `PUBLIC_SITE_URL` first for deterministic callback origin resolution.

- `src/lib/server/auth.ts`
  - Shared cookie helpers for SSR auth bootstrap.
  - Detects the Better Auth Convex JWT cookie.

- `src/routes/+layout.server.ts`
  - Feeds initial auth state from cookies into the root layout.

- `src/hooks.server.ts`
  - Extracts the Convex auth token from Better Auth cookies and stores it in `event.locals.token`.

- `src/routes/(app)/+layout.server.ts`
  - Protects members-only routes with a server redirect to `/auth?redirectTo=...`.

- `src/routes/auth/+page.svelte`
  - Social-only sign-in surface for Google and Apple.

## Request flow

### Sign-in flow

1. A user visits `/auth`.
2. The auth page calls `authClient.signIn.social(...)` for Google or Apple.
3. SvelteKit proxies the Better Auth request through `/api/auth/[...all]` to Convex using `PUBLIC_CONVEX_SITE_URL`.
4. Better Auth completes the provider flow and writes the Better Auth session cookie plus the Convex JWT cookie.
5. SSR reads the Better Auth Convex JWT cookie to derive initial auth state.
6. Client hydration exchanges the Better Auth session for Convex auth state and initializes the app shell.

### Protected route flow

1. A user requests `/app` or another route in the `(app)` group.
2. `src/hooks.server.ts` reads the Better Auth Convex JWT cookie.
3. `src/routes/(app)/+layout.server.ts` redirects unauthenticated users to `/auth?redirectTo=...`.
4. After successful sign-in, the auth page returns the user to the original route.

## Cookies and SSR

The current server-side bootstrap only depends on Better Auth's Convex JWT cookie contract.

Cookie candidates checked in order:

- `better-auth.convex-jwt`
- `__Secure-better-auth.convex-jwt`

SSR uses cookie presence only to derive the initial auth state. Full auth validation still happens through the Better Auth + Convex client integration after hydration.

## Environment variable contract

### Convex / Better Auth server env vars

These variables are required by `src/convex/auth.ts`:

- `SITE_URL`
- `BETTER_AUTH_SECRET`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `AUTH_APPLE_ID`
- `AUTH_APPLE_SECRET`

Optional:

- `AUTH_APPLE_APP_BUNDLE_IDENTIFIER`

Legacy duplicate names such as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are intentionally ignored.

### Public auth env vars

These variables are used by the SvelteKit-side auth plumbing:

- `PUBLIC_SITE_URL`
- `PUBLIC_CONVEX_SITE_URL`

### Public Convex client env var

The main Convex client still connects through the deployment URL, so the frontend also needs:

- `PUBLIC_CONVEX_URL`

This is not an auth provider config value. It is the Convex client transport URL.

## Apple setup and local development limitation

Apple Sign in is implemented in a production-ready way, but Apple web auth has a hard platform constraint:

- Apple requires HTTPS.
- Apple cannot complete a web sign-in flow on `http://localhost`.
- Better Auth Apple configuration also requires `trustedOrigins: ["https://appleid.apple.com"]`.

Practical consequence:

- The Apple provider is configured server-side.
- The UI explains the limitation in local development.
- Google remains the locally verifiable provider on `http://localhost`.

## Operations checklist

### Rotating secrets

When rotating auth secrets or provider credentials:

1. Update the relevant Convex deployment environment variables.
2. Update local development env files if needed.
3. Restart local dev servers.
4. Re-run `pnpm test` and `pnpm check`.
5. Verify `/auth` and the Google handoff in the browser.

### Adding another provider later

If Celstate adds another provider in the future:

1. Extend `src/lib/auth/config.ts` with canonical env parsing and validation.
2. Extend `src/convex/auth.ts` social provider registration.
3. Extend `src/lib/auth/providers.ts` UI descriptors.
4. Add regression tests for env validation and route behavior.
5. Update this document.

## Intentionally out of scope

These are not part of the active auth system:

- Email/password authentication
- Password reset flows
- Magic links
- Anonymous sessions
- Native Apple ID token flows without additional mobile-specific setup
