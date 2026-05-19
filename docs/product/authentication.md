# Authentication

**Canonical product and engineering reference** for Celstate sign-in, session handling, and protected routes. Older bookmarks may point to `docs/product/AUTH.md`, which redirects here.

## Overview

Celstate uses **WorkOS AuthKit** on the **SvelteKit** server with **Convex custom JWT** validation. The product shape:

- Social identity via WorkOS User Management (**Google** live; **Apple** configured through WorkOS when enabled).
- **No email/password** — avoids password storage and reset flows.
- Members-only routes are enforced on the **server** (`requireAuthKitSession` / `(app)/+layout.server.ts`).
- The browser obtains Convex credentials through **`/api/auth/access-token`** (`fetchAccessToken` in `(app)/+layout.svelte`).
- The public site follows **one canonical origin** (`PUBLIC_SITE_URL` + hooks).

## Why email/password is not supported

Celstate does not want to own password storage, reset flows, breach handling, or another low-trust account surface. Delegating to WorkOS + OIDC keeps the surface small.

## Architecture map

### Core pieces

- `src/hooks.server.ts` — `@workos/authkit-sveltekit` (`authKitHandle`, `configureAuthKit`); canonical host redirects; `locals.auth` + `locals.token` (`accessToken` for Convex); structured auth logging.
- `src/lib/server/authkit-guard.ts` — HTML route guard (AuthKit `user` present); preserves pathname + query in `redirectTo`.
- `src/routes/(app)/+layout.server.ts` — Protected app shell: calls `requireAuthKitSession`.
- `src/routes/(app)/+layout.svelte` — Convex `setupAuth` + `users.storeUser` bootstrap; protected-session UX (grace period, retries).
- `src/routes/api/auth/access-token/+server.ts` — JSON access token for Convex (`Cache-Control: no-store`). Session refresh runs in `authKitHandle` on every request; there is no separate refresh query parameter.
- `src/routes/api/auth/session/+server.ts` — JSON `{ authenticated: boolean }` for probes (`no-store`).
- `src/routes/api/auth/convex-ready/+server.ts` — Optional authenticated Convex `users.getMe` probe (`no-store`).
- `src/routes/auth/+page.svelte` — Sign-in surface (WorkOS).
- `src/routes/callback/+server.ts` — AuthKit callback (see WorkOS routes).
- `src/convex/auth.config.ts` — Convex **custom JWT** providers for WorkOS issuers + JWKS (`WORKOS_CLIENT_ID` on Convex).
- `src/convex/users.ts` — Idempotent `users.storeUser` / `upsertCurrentUser` (**`workosUserId` first**, then token, then normalized-email adoption; legacy subject merge).

### Supporting

- `src/lib/auth/redirect.ts` — `redirectTo` query builder for `/auth`.
- `src/lib/auth/protected-session.ts` — Client shell policy (loading, sync retries, redirect plan).
- `src/lib/server/auth-alerts.ts` — Rate-limited Sentry + webhook alerts for auth endpoints.
- `src/lib/server/convex-site-url.ts` — Derives `https://…convex.site` for HTTP actions when needed (verification, not AuthKit).

## Dependencies

| Package | Role |
|--------|------|
| `@workos/authkit-sveltekit` | AuthKit session + SvelteKit integration |
| `@mmailaender/convex-svelte` | Convex client + auth bridge |
| `convex` | Backend, `auth.config.ts` JWT validation |

## Request flow

### Sign-in

1. User visits `/auth` and starts AuthKit (WorkOS-hosted OAuth).
2. Callback establishes encrypted session cookie; `hooks` populate `locals.auth`.
3. For `/app`, the server guard ensures `locals.auth.user` exists; unauthenticated users go to `/auth?redirectTo=…`.
4. The client calls `/api/auth/access-token` to pass the JWT to Convex (`setAuth`).

### Protected routes (`/app/*`)

1. `+layout.server.ts` runs `requireAuthKitSession`.
2. Client `setupAuth` mirrors server authenticated state and refreshes tokens through `/api/auth/access-token`.
3. `users.storeUser` upserts the app user (non-blocking for authz).

## Cookies and SSR

Session state is **AuthKit’s encrypted cookie** (see WorkOS docs). `locals.token` mirrors `accessToken` for Convex. **Do not cache** auth JSON endpoints — responses are `Cache-Control: no-store`.

## Enduring lessons

1. **One canonical public origin** — OAuth return URL and `PUBLIC_SITE_URL` must match deployment host; hooks redirect off-canonical hosts.
2. **Separate env boundaries** — WorkOS **server** secrets on Vercel (`WORKOS_*`, optional `SENTRY_DSN`); `WORKOS_CLIENT_ID` (and any Convex-only secrets) on Convex per [`SECRETS-MANAGEMENT.md`](../runbooks/SECRETS-MANAGEMENT.md).
3. **No CDN caching of auth APIs** — `access-token`, `session`, `convex-ready`: `no-store`.
4. **Server vs client** — `+layout.server.ts` is the route guard; the client layout handles UX only.
5. **User row vs auth** — `users.storeUser` is provisioning; queries should tolerate a short window before the row exists.

## WorkOS JWT claims and Convex `UserIdentity`

Convex [custom JWT](https://docs.convex.dev/auth/advanced/custom-jwt) only requires `sub`, `iss`, `exp` (and typically `iat` for client refresh). Standard OIDC claims such as `email`, `email_verified`, `name`, and `picture` are mapped to `UserIdentity` **when the access token includes them**.

Default WorkOS AuthKit access tokens are often minimal (`sub`, `sid`, `iss`, org/scopes, etc.). **Operator contract:**

1. **Stable identity** — Provisioning keys off `sub` (`identity.subject`) and `users.workosUserId` (see `users.storeUser`). Email is optional on the token and stored **lowercased** when present.
2. **Email verification** — `users.storeUser` rejects only when Convex supplies an explicit `emailVerified === false`. If you require proof of verification in the database layer, configure the WorkOS JWT / access token (per WorkOS dashboard documentation for your plan) so `email_verified` is emitted when applicable.
3. **Product fields** — For `email`, `name`, and `pictureUrl` in Convex, ensure the issued JWT includes the corresponding OIDC claims (or map custom claims and read them via `identity["claim.path"]` per Convex docs).

Decode a real token (e.g. jwt.io in a secure context) after changes to confirm claim shape before merge.

## Token refresh

`authKitHandle()` in `src/hooks.server.ts` refreshes the AuthKit session when the SDK detects an expired or refreshed access token and rewrites the session cookie on the response. `/api/auth/access-token` only reads `event.locals.auth.accessToken` after that handle runs — it does not perform a separate refresh step. The exported `authKit.refreshSession` in `@workos/authkit-sveltekit` 0.3.0 is a no-op; do not rely on it.

## Pre-merge proof (auth-boundary PRs)

CI exercises mocks and Vitest contracts; it does not speak to live WorkOS issuers. Before merging auth-boundary changes:

1. Sign in against **dev or staging** with a real WorkOS user; confirm `/api/auth/access-token` returns a JWT and `users.storeUser` succeeds.
2. Inspect the access token claims (secure environment) and update WorkOS JWT settings if the product requires `email` / `email_verified` in Convex.
3. Run `pnpm check:kit-server-env` and `pnpm check:convex-auth` (or your env’s documented gates) with Doppler-loaded secrets.

## Observability

Structured JSON logs: `scope: "auth"` in `hooks.server.ts` for `/auth`, `/api/auth/*`, `/sign-in`, `/callback`, `/sign-out`. Alerts: `src/lib/server/auth-alerts.ts`. Full stack notes: [`observability.md`](observability.md).

## Regression coverage

- `src/lib/server/authkit-guard.test.ts`
- `src/lib/server/access-token-response.ts` / `access-token-response.test.ts` — `/api/auth/access-token` JSON contract
- `src/lib/auth/protected-session.test.ts`
- `src/lib/server/auth-guard.test.ts`
- `src/lib/server/auth-alerts.test.ts`
- `src/convex/users.provisioning.test.ts`
- `scripts/auth-canary-probe.test.ts` — session probe contract

CI: `pnpm test:auth` then `pnpm verify`. Scheduled canary: `scripts/check-auth-health.mjs` (`/auth` + `/api/auth/session`). See [`CI-AND-CANARIES.md`](../runbooks/CI-AND-CANARIES.md).

## Environment variables

### SvelteKit / Vercel (server runtime)

Set in Doppler and sync with `pnpm secrets:sync:vercel` (includes allowlisted server keys):

- `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_REDIRECT_URI`, `WORKOS_COOKIE_PASSWORD` (≥ 32 chars)
- Optional: `SENTRY_DSN`

Validate: `pnpm check:kit-server-env` (local / operator) or `node scripts/verify-doppler-kit-env.mjs` (release script; reads Doppler).

### Convex

- `WORKOS_CLIENT_ID` — must match AuthKit client; used in `auth.config.ts` JWKS URL (required for Convex to accept user JWTs).
- **Propagating from Doppler:** `pnpm secrets:sync:convex:dev` (development deployment) or `pnpm secrets:sync:convex` (production). These scripts bulk-apply all non-`PUBLIC_*` Doppler secrets to Convex via the CLI; only **`WORKOS_CLIENT_ID`** is required for JWT validation, but the sync keeps dev/prod aligned with the rest of the backend secrets.

Other Convex secrets remain per [`SECRETS-MANAGEMENT.md`](../runbooks/SECRETS-MANAGEMENT.md).

### Public (`PUBLIC_*`)

- `PUBLIC_SITE_URL`, `PUBLIC_CONVEX_URL`, etc. — see [`PUBLIC-ENV-CHECKLIST.md`](../runbooks/PUBLIC-ENV-CHECKLIST.md).

### Local development

Use `doppler run -- pnpm dev` or copy [.env.example](../../.env.example) to `.env.local`. Run `pnpm check:kit-server-env` and `pnpm check:public-env` after URL changes.

## Operations

- **Secrets:** Doppler → `pnpm secrets:sync:convex` / `pnpm secrets:sync:vercel` — never `convex env list`.
- **Release:** `pnpm release:production` — syncs secrets, validates Doppler WorkOS kit env, deploys Convex + Vercel, runs `pnpm verify:production`.
- **`pnpm exec convex codegen`** / **`pnpm exec convex dev --once`** — Regenerates `src/convex/_generated/*`. Requires **`WORKOS_CLIENT_ID` set on the linked Convex deployment** (via `pnpm secrets:sync:convex:dev` or prod sync); otherwise bundling fails when loading `auth.config.ts`.

## Sign out

WorkOS AuthKit `signOut` clears the session cookie and redirects per `src/routes/sign-out/+server.ts`.

## Intentionally out of scope

- Email/password authentication  
- Magic links  
- Anonymous sessions  
