# Authentication

## Overview

Celstate uses **Better Auth on Convex** with a SvelteKit proxy layer for authentication.

The active product shape is:

- `google` sign-in is enabled
- `apple` is implemented but temporarily disabled
- email/password is intentionally unsupported

`docs/product/AUTH.md` is the source of truth for architecture, environment requirements, troubleshooting, and operational guidance.

## Architecture

### Backend (`src/convex/auth.ts`)

- Better Auth runs on Convex via `@convex-dev/better-auth`
- social providers and trusted origins are configured through `src/lib/auth/config.ts`
- Better Auth HTTP routes are registered on the Convex router

### Frontend Client (`src/lib/auth-client.ts`)

- the browser auth client uses Better Auth's Svelte integration
- auth requests stay same-origin by preferring `window.location.origin`
- the protected app explicitly initializes the Convex Better Auth bridge with `PUBLIC_CONVEX_URL`

### Auth Proxy (`src/routes/api/auth/[...all]/+server.ts`)

- browser auth requests go through the SvelteKit proxy
- the proxy forwards the request to Convex using `PUBLIC_CONVEX_SITE_URL`
- forwarded host and protocol headers are preserved so callback resolution uses the real public origin

## OAuth Flow

1. The user starts sign-in from `/auth`
2. The browser calls `/api/auth/...` on the same origin
3. SvelteKit proxies the request to Convex Better Auth
4. Better Auth completes the provider flow and writes the session cookies plus the Convex JWT cookie
5. SSR uses cookie presence to seed the initial auth snapshot
6. The protected app hydrates the Better Auth + Convex client state

## Protected Routes

- `/app/*` is protected on the server in `src/routes/(app)/+layout.server.ts`
- the client protected-app layout handles transient auth-state churn after hydration
- protected-route rendering is no longer blocked on `users.storeUser`

## User Bootstrap

- after successful auth, the app ensures the corresponding Convex user row exists
- this sync runs in the background and is not a route-protection requirement
- user-dependent queries must tolerate a brief post-login window where the row is still being created

## Sign Out

Signing out clears the Better Auth session through the same-origin auth client and returns the user to the public experience.
