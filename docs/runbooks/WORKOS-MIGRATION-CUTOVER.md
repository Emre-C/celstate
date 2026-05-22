# WorkOS AuthKit cutover posture

**Current stack:** Celstate ships **WorkOS AuthKit** on SvelteKit with **Convex custom JWT** validation. Product reference: [`authentication.md`](../product/authentication.md).

## If you are rolling back from a bad deploy

**Revert** the last **Convex** and **Vercel** production deployments to the last known-good revisions (deployment history in each vendor). Then re-run `pnpm secrets:diff` and `pnpm verify:production` when stable.

## Atomic window (historical note)

During the AuthKit migration, **old browser sessions** (pre–AuthKit cookies) no longer authorized Convex until users completed a **WorkOS AuthKit** sign-in again. For any future auth-boundary change, assume a similar “re-sign-in” window and plan comms if support volume warrants it.

## Release ordering (`pnpm release:production`)

The script syncs secrets, deploys **Convex**, then **Vercel**, then runs verification. There is no safe ordering that avoids **some** seconds where an old client and new backend disagree—keep deploys back-to-back and verify immediately after.

## Manual staged alternative

For extra caution, an operator can:

1. `pnpm secrets:sync:convex` and `pnpm secrets:sync:vercel`
2. Deploy Convex (`pnpm exec convex deploy --yes`)
3. Deploy Vercel (`pnpm exec vercel deploy --prod --yes`) as soon as Convex finishes
4. `pnpm verify:production`

## Ongoing checks (prod and dev)

- WorkOS dashboard: redirect URI, sign-in endpoint (`/api/auth/initiate`), callback (`/callback`), sign-out redirect; values must match `PUBLIC_SITE_URL` / `WORKOS_REDIRECT_URI`.
- Doppler → **`pnpm secrets:sync:convex`** / **`pnpm secrets:sync:convex:dev`** so Convex has at least **`WORKOS_CLIENT_ID`** (required by `auth.config.ts`); full **`WORKOS_*`** on **Vercel** per [PUBLIC-ENV-CHECKLIST](./PUBLIC-ENV-CHECKLIST.md).
- `pnpm exec convex codegen` (or `pnpm exec convex dev --once`) so `_generated` matches the linked deployment.
