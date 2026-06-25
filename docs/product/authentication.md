# Authentication

**Canonical product and engineering reference** for Celstate sign-in, session handling, and protected routes. Older bookmarks may point to `docs/product/AUTH.md`, which redirects here.

## Overview

Celstate uses **Clerk** on the **SvelteKit** server with **Convex custom JWT** validation. The product shape:

- Social identity via Clerk (**Google** live; **Apple** when enabled in the Clerk dashboard).
- **No email/password** — avoids password storage and reset flows.
- Members-only routes are enforced on the **server** (`requireClerkSession` / `(app)/+layout.server.ts`).
- The browser obtains Convex credentials through Clerk’s **`convex` JWT template** (`session.getToken({ template: 'convex' })` in `(app)/+layout.svelte`).
- The public site follows **one canonical origin** (`PUBLIC_SITE_URL` + hooks).

## Why email/password is not supported

Celstate does not want to own password storage, reset flows, breach handling, or another low-trust account surface. Delegating to Clerk + OIDC keeps the surface small.

## Architecture map

### Core pieces

- `src/hooks.server.ts` — `withClerkHandler()` from `svelte-clerk/server`; canonical host redirects; structured auth logging for `/api/auth/*`, `/auth`, `/callback`, `/sign-out`.
- `src/routes/+layout.svelte` — `ClerkProvider` with editorial appearance tokens aligned to [`design-system.md`](design-system.md).
- `src/lib/server/clerk-guard.ts` — HTML route guard (`locals.auth().userId`); preserves pathname + query via `/api/auth/initiate` → `/auth`.
- `src/routes/(app)/+layout.server.ts` — Protected app shell: calls `requireClerkSession`.
- `src/routes/(app)/+layout.svelte` — Convex `setupAuth` + `users.storeUser` bootstrap; protected-session UX (grace period, retries).
- `src/routes/api/auth/session/+server.ts` — JSON `{ authenticated: boolean }` for probes (`no-store`).
- `src/routes/api/auth/convex-ready/+server.ts` — Optional authenticated Convex `users.getMe` probe (`no-store`).
- `src/routes/api/auth/access-token/+server.ts` — Legacy endpoint; returns **410** (tokens come from Clerk client SDK).
- `src/routes/auth/+page.svelte` — Celstate sign-in surface (`<SignIn />` from `svelte-clerk`).
- `src/routes/auth/+page.server.ts` — `returnTo` / error query normalization for recovery UX.
- `src/routes/api/auth/initiate/+server.ts` — Redirects unauthenticated HTML flows to `/auth?redirectTo=…`.
- `src/routes/callback/+server.ts` — Compatibility redirect to `/auth` (Clerk handles OAuth callbacks via SDK routes).
- `src/routes/sign-out/+server.ts` — Redirects to `/` (Clerk `afterSignOutUrl` on `ClerkProvider`).
- `src/convex/auth.config.ts` — Convex JWT provider for Clerk issuer + `applicationID: "convex"`.
- `src/convex/users.ts` — Idempotent `users.storeUser` / `upsertCurrentUser`. Resolves all rows an identity matches (clerk subject, token, verified email), picks the **oldest as canonical**, and merges any duplicates into it (`mergeUserInto`) so one verified human maps to one row.

### Supporting

- `src/lib/auth/redirect.ts` — `redirectTo` query builder for `/auth`; `normalizeAuthReturnTo` for safe post-auth paths.
- `src/lib/auth/protected-session.ts` — Client shell policy (loading, sync retries, redirect plan).
- `src/lib/server/auth-alerts.ts` — Rate-limited Sentry + webhook alerts for auth endpoints.
- `src/lib/server/convex-site-url.ts` — Derives `https://…convex.site` for HTTP actions when needed (verification, not Clerk).

## Dependencies

| Package | Role |
|--------|------|
| `svelte-clerk` | Clerk session + SvelteKit integration |
| `@mmailaender/convex-svelte` | Convex client + auth bridge |
| `convex` | Backend, `auth.config.ts` JWT validation |

## Request flow

### Sign-in

1. Unauthenticated users hit `/api/auth/initiate?returnTo=…` (from protected routes or marketing CTAs), which redirects to `/auth?redirectTo=…`.
2. User completes OAuth via Clerk (`<SignIn />` on `/auth`).
3. Clerk establishes the session cookie; `withClerkHandler()` populates `locals.auth()`.
4. The client calls `clerk.session.getToken({ template: 'convex' })` and passes the JWT to Convex (`setAuth`).

`/auth` is the primary sign-in surface. It also handles **error recovery** when OAuth returns with an `error` query param.

### Protected routes (`/app/*`)

1. `+layout.server.ts` runs `requireClerkSession`.
2. Client `setupAuth` waits for Clerk to load, fetches the Convex template token, and mirrors server authenticated state.
3. `users.storeUser` upserts the app user after Convex auth is ready (non-blocking for route authz).

## Cookies and SSR

Session state is **Clerk’s HTTP-only session cookie** (typically `__session`). **Do not cache** auth JSON endpoints — responses use `Cache-Control: no-store`.

## Enduring lessons

1. **One canonical public origin** — OAuth return URL and `PUBLIC_SITE_URL` must match deployment host; hooks redirect off-canonical hosts.
2. **Separate env boundaries** — Clerk **server** secrets on Vercel (`CLERK_SECRET_KEY`, optional `SENTRY_DSN`); `CLERK_JWT_ISSUER_DOMAIN` on Convex per [`SECRETS-MANAGEMENT.md`](../runbooks/SECRETS-MANAGEMENT.md).
3. **No CDN caching of auth APIs** — `session`, `convex-ready`: `no-store`.
4. **Server vs client** — `+layout.server.ts` is the route guard; the client layout handles UX and Convex token handoff only.
5. **Convex bootstrap race** — Wait for Clerk + Convex auth before `users.storeUser`; see `protected-session.ts`.

## Clerk JWT template and Convex `UserIdentity`

Clerk must expose a JWT template named **`convex`** (issuer domain → `CLERK_JWT_ISSUER_DOMAIN` on Convex).

> **Required claims (do not skip).** Clerk's "Connect with Convex" flow pre-maps **only** the `aud` claim. You **must** add `email` and `email_verified` yourself, or Convex's `getUserIdentity()` returns them as `undefined`. Without them, account linking and WorkOS→Clerk cutover consolidation **silently cannot run** — every sign-in resolves to a `clerkUserId`-only shell, stranding the user's real account, credits, and generations. This is not optional for Celstate. In **Clerk Dashboard → JWT Templates → `convex` → Claims**, ensure:
>
> ```json
> {
>   "aud": "convex",
>   "email": "{{user.primary_email_address}}",
>   "email_verified": "{{user.email_verified}}"
> }
> ```
>
> Apply this to **every** environment (dev + production instances each have their own template).

**Operator contract:**

1. **Stable identity** — Provisioning keys off `sub` (`identity.subject` → `users.clerkUserId`). A *verified* `email` is the link key that adopts a pre-existing account and consolidates a cutover shell; it is stored **lowercased**. See `users.upsertUserRecord` / `mergeUserInto`.
2. **Canonical resolution** — When one identity matches multiple rows (legacy account + shell), the **oldest row wins** (it holds the established history); the write path merges the rest into it. Read (`getMe`) and write (`storeUser`) share this ordering, so the UI is correct even before the merge mutation runs.
3. **Email verification** — `users.storeUser` rejects only when Convex supplies an explicit `emailVerified === false`. Email-based adoption is allowed when `email_verified` is `true` or absent, never when `false`. A missing `email` claim is logged as a `console.warn` in the Convex deployment (a misconfiguration signal).
4. **Provider hints** — `resolveAuthProviderFromIdentity` uses email heuristics for analytics (e.g. `@privaterelay.appleid.com` → Apple).

## Pre-merge verification (auth boundary changes)

CI exercises mocks and Vitest contracts; it does not speak to live Clerk issuers. Before merging auth-boundary changes:

1. Sign in against **dev or staging** with a real Clerk user; confirm Convex queries succeed and `users.storeUser` completes.
2. **Confirm the token actually carries `email` and `email_verified`.** Either decode the `convex` template token (Clerk Dashboard → JWT Templates → `convex` → *Preview*, or paste a live token into [jwt.io](https://jwt.io/)) and check the payload, or watch the Convex deployment logs for the `has no email claim` warning emitted by `upsertCurrentUser`. If the claims are missing, fix the template (see required-claims block above) before relying on account linking.

## Clerk domain and branding (production)

Production should use a **custom Clerk domain** (e.g. `accounts.celstate.com`) and Dashboard **Appearance** aligned with [`design-system.md`](design-system.md):

- Warm parchment background (`#F5F3ED`), terracotta primary (`#C2410C`), DM Sans, light-only.
- `ClerkProvider` `appearance` in `src/routes/+layout.svelte` mirrors the same tokens for embedded components.
- See [Clerk custom domains](https://clerk.com/docs/deployments/overview) and [appearance](https://clerk.com/docs/customization/overview).

## Regression coverage

- `src/lib/server/clerk-guard.test.ts`
- `src/lib/auth/protected-session.test.ts`
- `src/lib/server/auth-alerts.test.ts`
- `src/convex/users.provisioning.test.ts`
- `scripts/canary/auth-canary-probe.test.ts` — session probe contract
- `scripts/canary/auth-canary-clerk-fapi.test.ts` — Clerk FAPI host decode + script probe contract

CI: `pnpm test:auth` then `pnpm verify`. Scheduled canary: `scripts/check-auth-health.mjs` (`/auth` + `/api/auth/session`). See [`CI-AND-CANARIES.md`](../runbooks/CI-AND-CANARIES.md).

## Environment variables

### SvelteKit / Vercel (server runtime)

Set in Doppler and sync with `pnpm secrets:sync:vercel` (includes allowlisted server keys):

- `CLERK_SECRET_KEY`, `PUBLIC_CLERK_PUBLISHABLE_KEY`
- `PUBLIC_CLERK_SIGN_IN_URL`, `PUBLIC_CLERK_SIGN_UP_URL`, fallback redirect URLs (see `.env.example`)
- Optional: `SENTRY_DSN`

Validate: `pnpm check:kit-server-env` (local / operator) or `node scripts/checks/verify-doppler-kit-env.mjs` (release script; reads Doppler).

### Convex

- `CLERK_JWT_ISSUER_DOMAIN` — Clerk Frontend API issuer URL; used in `auth.config.ts` (required for Convex to accept user JWTs).
- **Propagating from Doppler:** `pnpm secrets:sync:convex:dev` (development deployment) or `pnpm secrets:sync:convex` (production).

Other Convex secrets remain per [`SECRETS-MANAGEMENT.md`](../runbooks/SECRETS-MANAGEMENT.md).

### Public (`PUBLIC_*`)

- `PUBLIC_SITE_URL`, `PUBLIC_CONVEX_URL`, `PUBLIC_CLERK_PUBLISHABLE_KEY`, etc. — see [`PUBLIC-ENV-CHECKLIST.md`](../runbooks/PUBLIC-ENV-CHECKLIST.md).

### Local development

Use `doppler run -- pnpm dev` or copy [.env.example](../../.env.example) to `.env.local`. Run `pnpm check:kit-server-env` and `pnpm check:public-env` after URL changes.

## Operations

- **Secrets:** Doppler → `pnpm secrets:sync:convex` / `pnpm secrets:sync:vercel` — never `convex env list`.
- **Release:** `pnpm release:production` — syncs secrets, validates Doppler Clerk env, deploys Convex + Vercel, runs `pnpm verify:production`.
- **`pnpm exec convex codegen`** / **`pnpm exec convex dev --once`** — Requires **`CLERK_JWT_ISSUER_DOMAIN`** on the linked Convex deployment (via `pnpm secrets:sync:convex:dev` or prod sync); otherwise bundling fails when loading `auth.config.ts`.

## Sign out

Clerk clears the session via `ClerkProvider` `afterSignOutUrl="/"`. `/sign-out` redirects to `/` for compatibility with bookmarks and canaries.

## Intentionally out of scope

- Email/password authentication  
- Magic links  
- Anonymous sessions  
