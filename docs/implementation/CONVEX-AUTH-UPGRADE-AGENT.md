# Convex Auth Upgrade Agent — Specification

> **Purpose:** This document contains every piece of context an AI agent needs to monitor `@convex-dev/auth` for new versions, determine what changed, and perform a safe upgrade of Celstate's custom Svelte 5 auth client — including rebuilding the hand-rolled auth module if the server action contract changes.

---

## 1. WHY THIS AGENT EXISTS

`@convex-dev/auth` only ships an official React client. Celstate is a **pure Svelte 5 + SvelteKit** application — zero React. We built a custom auth client by reverse-engineering the React client's source code to understand the undocumented server action API contract.

This means:
- We depend on an **internal API** (`auth:signIn`, `auth:signOut` server actions) that has no stability guarantees
- The library is in **beta** (version `0.0.x`) — the Convex team explicitly states it "may change in backward-incompatible ways"
- TypeScript doesn't help because we call actions via `client.action('auth:signIn' as any, {...})` — the `as any` bypasses all type checking
- Any field rename, validator change, or response shape change silently breaks auth at runtime

---

## 2. CURRENT PINNED VERSIONS

```json
{
  "@convex-dev/auth": "0.0.91",
  "@auth/core": "0.37.0",
  "convex": "^1.32.0",
  "convex-svelte": "^0.0.12"
}
```

`@convex-dev/auth` and `@auth/core` are **exact-pinned** (no `^` range). `convex` and `convex-svelte` use ranges because they have stable public APIs and don't affect the auth contract.

---

## 3. TECH STACK CONTEXT

| Layer | Technology | Notes |
|---|---|---|
| Framework | SvelteKit | Routes under `src/routes/` |
| UI Reactivity | Svelte 5 runes | `$state`, `$derived`, `$effect`, `$props` |
| Backend | Convex | Functions in `src/convex/` |
| Convex Client | `convex-svelte` | `setupConvex()`, `useConvexClient()`, `useQuery()` |
| Auth (server) | `@convex-dev/auth/server` | `convexAuth()` in `src/convex/auth.ts` |
| Auth (client) | **Custom hand-rolled** | `src/lib/auth/auth.svelte.ts` + `src/lib/auth/storage.ts` |
| OAuth Provider | Google | Via `@auth/core/providers/google` |
| CSS | Tailwind CSS v4 | Theme tokens in `src/app.css` |

**There is NO React anywhere in this project.** Never introduce React.

---

## 4. ARCHITECTURE — FILE MAP

### Files the agent may need to modify:

```
src/lib/auth/auth.svelte.ts     ← Custom auth state provider (THE fragile module)
src/lib/auth/storage.ts         ← localStorage helpers (unlikely to need changes)
src/routes/auth/callback/+page.svelte  ← OAuth code exchange page
src/convex/auth.ts              ← Server-side auth config (convexAuth + providers)
src/convex/auth.config.ts       ← OIDC provider config
src/convex/schema.ts            ← Database schema (uses authTables spread)
src/routes/(app)/+layout.svelte ← Calls setupConvex() + setupConvexAuth()
src/routes/(app)/app/+layout.svelte ← Consumes useConvexAuth(), renders auth gate
scripts/test-auth-contract.ts   ← Contract smoke test
package.json                    ← Version pins
```

### Files the agent should NOT modify:

```
src/routes/(marketing)/*        ← Landing page, no auth dependencies
src/routes/+layout.svelte       ← Pure shell, no Convex
src/convex/generation.ts        ← Business logic, unrelated
src/convex/generations.ts       ← Business logic, unrelated
src/convex/users.ts             ← User queries, depends on auth indirectly
```

---

## 5. THE SERVER ACTION CONTRACT (Baseline: v0.0.91)

This is the exact API our client depends on. The agent must diff any new version against this contract.

### `auth:signIn` Action

**Validator accepts exactly these top-level fields:**
```typescript
{
  calledBy?: string,       // Internal — we never send this
  params?: Record<string, any>,  // Bag of provider-specific params
  provider?: string,       // e.g. "google"
  refreshToken?: string,   // For token refresh flow
  verifier?: string,       // PKCE verifier for code exchange
}
```

**Usage Pattern 1 — OAuth Initiation:**
```typescript
// Request:
{ provider: "google", params: { redirectTo: "/auth/callback" } }

// Response:
{ redirect: "https://accounts.google.com/...", verifier: "abc123..." }
```
- `redirectTo` MUST be inside `params`, NOT at top level
- Response contains `redirect` (URL string) and `verifier` (PKCE string)
- Response does NOT contain `tokens`

**Usage Pattern 2 — Code Exchange (OAuth callback):**
```typescript
// Request:
{ params: { code: "auth-code-from-google" }, verifier: "abc123..." }

// Response:
{ tokens: { token: "jwt...", refreshToken: "refresh..." } }
```
- `code` is inside `params`
- `verifier` is at top level (consumed from localStorage, stored during initiation)
- Response contains `tokens` object with `token` (JWT) and `refreshToken`

**Usage Pattern 3 — Token Refresh:**
```typescript
// Request:
{ refreshToken: "refresh..." }

// Response:
{ tokens: { token: "new-jwt...", refreshToken: "new-refresh..." } }
```
- `refreshToken` at top level
- Response shape identical to code exchange

### `auth:signOut` Action

**Validator accepts:** `{}` (empty object)

No meaningful response. May throw if not authenticated — we catch and ignore.

### Known Pitfall (Bug We Already Hit)

`redirectTo` at the top level causes `ArgumentValidationError`:
```typescript
// ❌ WRONG — causes ArgumentValidationError
{ provider: "google", redirectTo: "/auth/callback" }

// ✅ CORRECT
{ provider: "google", params: { redirectTo: "/auth/callback" } }
```

---

## 6. THE THREE CLIENT-SIDE CALL SITES

The agent must update ALL of these if the contract changes:

### Call Site 1: `src/lib/auth/auth.svelte.ts` — `signIn()` method (line ~108)
```typescript
const result = await client.action('auth:signIn' as any, {
    provider,
    params: { redirectTo: '/auth/callback' },
});
```
Uses: WebSocket-based `ConvexClient` (from `convex-svelte`)

### Call Site 2: `src/lib/auth/auth.svelte.ts` — `fetchAccessToken()` (line ~81)
```typescript
const result = await httpClient.action('auth:signIn' as any, {
    refreshToken,
});
```
Uses: `ConvexHttpClient` (stateless HTTP, not WebSocket)

### Call Site 3: `src/routes/auth/callback/+page.svelte` — Code exchange (line ~28)
```typescript
const result = await httpClient.action('auth:signIn' as any, {
    params: { code },
    verifier,
});
```
Uses: `ConvexHttpClient` (stateless HTTP)

### Call Site 4: `src/lib/auth/auth.svelte.ts` — `signOut()` method (line ~124)
```typescript
await client.action('auth:signOut' as any, {});
```
Uses: WebSocket-based `ConvexClient`

---

## 7. LOCALSTORAGE KEY SCHEME

Keys are namespaced by Convex URL to support multiple deployments:
```
__convexAuthJWT_{escapedUrl}
__convexAuthRefreshToken_{escapedUrl}
__convexAuthOAuthVerifier_{escapedUrl}
__convexAuthReturnPath_{escapedUrl}
```

Where `escapedUrl` is `PUBLIC_CONVEX_URL` with all non-alphanumeric chars stripped. These key names match what the official React client uses. If the React client changes its key names, existing users will be silently logged out (tokens won't be found).

---

## 8. RESPONSE SHAPE EXPECTATIONS

Our code destructures responses like this:
```typescript
result.redirect      // string — OAuth redirect URL
result.verifier      // string — PKCE verifier
result.tokens        // object | null | undefined
result.tokens.token  // string — JWT
result.tokens.refreshToken  // string — refresh token
```

If any of these field names change, auth breaks silently. The agent must verify the response shape in new versions.

---

## 9. SERVER-SIDE CONFIG

### `src/convex/auth.ts`
```typescript
import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId }) {
      if (!existingUserId) {
        const user = await ctx.db.get(userId);
        if (user && user.credits === undefined) {
          await ctx.db.patch(userId, { credits: GENERATION_CONFIG.initialCredits });
        }
      }
    },
  },
});
```

The `convexAuth()` function and its exports (`auth`, `signIn`, `signOut`, `store`, `isAuthenticated`) are the server-side API. Changes to:
- The `convexAuth()` config shape
- The callback signatures (`afterUserCreatedOrUpdated` args)
- The exported function names
- The `authTables` schema shape (used in `schema.ts`)

...all require updates.

### `src/convex/auth.config.ts`
```typescript
export default {
  providers: [{ domain: process.env.CONVEX_SITE_URL, applicationID: "convex" }],
};
```

### `src/convex/schema.ts` (auth-relevant portion)
```typescript
import { authTables } from "@convex-dev/auth/server";
export default defineSchema({
  ...authTables,
  users: defineTable({ /* ... */ }),
  // ...
});
```

If `authTables` changes shape (adds/removes tables or fields), the schema must be updated and `npx convex dev` re-run.

---

## 10. UPSTREAM SOURCE CODE REFERENCES

The React client we reverse-engineered from:
```
https://github.com/get-convex/convex-auth/blob/main/src/react/client.tsx
```

The server-side implementation (contains the validator):
```
https://github.com/get-convex/convex-auth/blob/main/src/server/implementation.ts
```

The CHANGELOG:
```
https://github.com/get-convex/convex-auth/blob/main/CHANGELOG.md
```

The npm page:
```
https://www.npmjs.com/package/@convex-dev/auth
```

---

## 11. AGENT WORKFLOW

### Phase 1: Detection

1. Check npm for the latest version of `@convex-dev/auth`:
   ```bash
   npm view @convex-dev/auth version
   ```
2. Compare against current pin (`0.0.91` in `package.json`)
3. If same version → **STOP**. No action needed.
4. If different → proceed to Phase 2.

### Phase 2: Changelog Analysis

1. Fetch the CHANGELOG from GitHub:
   ```
   https://raw.githubusercontent.com/get-convex/convex-auth/main/CHANGELOG.md
   ```
2. Read all entries between the current version (`0.0.91`) and the latest version
3. Classify changes:
   - **Server action contract changes** (validator fields, response shapes) → HIGH RISK
   - **Server-side config API changes** (`convexAuth()`, callbacks, exports) → MEDIUM RISK
   - **React client changes only** → LOW RISK (we don't use React, but the React client mirrors the contract we reverse-engineered)
   - **Bug fixes, docs, internal refactors** → INFORMATIONAL
4. If HIGH RISK changes detected → proceed to Phase 3 before updating
5. If only LOW/INFORMATIONAL → proceed directly to Phase 5

### Phase 3: Contract Diff

1. Fetch the new version's server implementation:
   ```
   https://raw.githubusercontent.com/get-convex/convex-auth/main/src/server/implementation.ts
   ```
2. Find the `signIn` action validator (look for `v.object({` near the signIn action definition)
3. Diff the validator fields against the baseline in Section 5 of this document
4. Fetch the new version's React client:
   ```
   https://raw.githubusercontent.com/get-convex/convex-auth/main/src/react/client.tsx
   ```
5. Find how the React client constructs `signIn` call arguments
6. Diff against our three call patterns (initiation, code exchange, token refresh)
7. Document every difference found

### Phase 4: Code Update

If contract changes are detected:

1. **Update `src/lib/auth/auth.svelte.ts`:**
   - Update the contract documentation comment at the top of the file
   - Update all call sites (signIn, fetchAccessToken) to match new field names/shapes
   - Update response destructuring if response shape changed
   - Preserve the Svelte 5 runes pattern (`$state`, `setContext`/`getContext`)
   - Do NOT introduce React or any React patterns

2. **Update `src/routes/auth/callback/+page.svelte`:**
   - Update the `httpClient.action('auth:signIn', ...)` call if code exchange args changed
   - Update response destructuring if `result.tokens` shape changed

3. **Update `src/convex/auth.ts`:**
   - If `convexAuth()` config shape changed, update accordingly
   - If callback signatures changed, update `afterUserCreatedOrUpdated`
   - If exported names changed, update (and grep for all consumers)

4. **Update `src/convex/schema.ts`:**
   - If `authTables` shape changed, verify schema compatibility
   - May need to run a migration if tables/fields were added or removed

5. **Update `scripts/test-auth-contract.ts`:**
   - Update the contract test to validate the NEW expected shapes
   - Keep the old regression tests (e.g., "redirectTo at top level should fail") unless they're no longer applicable

6. **Update `src/lib/auth/storage.ts`:**
   - Only if localStorage key names changed in the official React client

### Phase 5: Version Bump

1. Update `package.json`:
   ```json
   "@convex-dev/auth": "NEW_VERSION",
   ```
   Keep it exact-pinned (no `^`).

2. If `@auth/core` also needs updating (peer dependency), update it too (exact-pinned).

3. Run:
   ```bash
   npm install
   ```

### Phase 6: Verification

Run ALL of these. Every single one must pass.

1. **TypeScript compilation:**
   ```bash
   npx svelte-check --tsconfig ./tsconfig.json
   ```
   Must return: `0 ERRORS 0 WARNINGS`

2. **Contract smoke test:**
   ```bash
   npm run test:auth
   ```
   Must return: all tests passed, 0 failed

3. **Convex function push:**
   ```bash
   npx convex dev --once
   ```
   Must deploy without errors (validates server-side auth config)

4. **Full sign-in flow (browser test):**
   - Start dev server: `npm run dev`
   - Navigate to `http://localhost:5173/app`
   - Should see sign-in screen (not a blank page, not an error)
   - Click "Sign in with Google"
   - Should redirect to Google OAuth consent
   - After consent, should redirect to `/auth/callback`
   - Should show "Signing you in…" briefly
   - Should redirect to `/app` with authenticated state
   - Should see user credits in nav bar
   - Click "Sign Out" — should return to sign-in screen

5. **Token refresh (manual test):**
   - After signing in, open browser DevTools → Application → Local Storage
   - Verify keys exist: `__convexAuthJWT_*` and `__convexAuthRefreshToken_*`
   - Delete `__convexAuthJWT_*` only (keep refresh token)
   - Refresh the page
   - Should auto-recover session via refresh token (not show sign-in screen)

6. **Landing page independence:**
   - Navigate to `http://localhost:5173/`
   - Should render instantly with zero loading delay
   - No Convex WebSocket connection should be initiated (check Network tab)

### Phase 7: Documentation

After successful upgrade:

1. Update the contract documentation comment in `src/lib/auth/auth.svelte.ts` to reflect the new version and any contract changes
2. Update the `CURRENT PINNED VERSIONS` section (Section 2) in THIS document
3. Update the `SERVER ACTION CONTRACT` section (Section 5) if the contract changed
4. Update the `RESPONSE SHAPE EXPECTATIONS` section (Section 8) if shapes changed

---

## 12. KNOWN FAILURE MODES & FIXES

### Failure: `ArgumentValidationError` on signIn

**Cause:** A field is being sent that the new validator doesn't accept, OR a field is at the wrong nesting level.

**Fix:** Diff the validator in the new version's `src/server/implementation.ts` against our call sites. Restructure the args object to match.

### Failure: `result.tokens` is undefined after code exchange

**Cause:** Response shape changed — tokens may be under a different key.

**Fix:** Check the React client's `signIn` method to see how it reads the response. Mirror that.

### Failure: Infinite reentrant loop (page freezes)

**Cause:** `client.setAuth(fetchAccessToken)` being called from within `setTokens()`, which is called from within `fetchAccessToken()`.

**Fix:** NEVER call `client.setAuth()` inside `setTokens()`. `client.setAuth()` should only be called:
- Once in `setupConvexAuth()` initialization
- Once after `signIn()` completes (non-redirect path)
- Once after `signOut()` completes

### Failure: Silent sign-out after upgrade

**Cause:** localStorage key names changed. Existing tokens can't be found.

**Fix:** Either migrate keys in `storage.ts`, or accept that users will need to re-authenticate once. This is generally acceptable.

### Failure: `authTables` schema mismatch

**Cause:** New version of `@convex-dev/auth` changed the tables or fields in `authTables`.

**Fix:** Run `npx convex dev` and check for schema errors. May need to add new fields to the `users` table override in `schema.ts`.

---

## 13. ESCAPE HATCH — MIGRATE TO `@convex-dev/better-auth`

If `@convex-dev/auth` becomes unmaintainable or introduces breaking changes that are too complex to adapt:

**`@convex-dev/better-auth`** (v0.10.10+) is a newer, **framework-agnostic** alternative maintained by the same Convex team. It explicitly supports Svelte, Vue, Astro, Solid, etc. — not just React.

- npm: `https://www.npmjs.com/package/@convex-dev/better-auth`
- Docs: `https://labs.convex.dev/better-auth`
- GitHub: `https://github.com/get-convex/better-auth`

This would be a full rewrite of the auth layer but would eliminate the "hand-rolled client reverse-engineered from React source" problem entirely. Evaluate this option if the upgrade agent encounters a version bump that changes the server action contract significantly (e.g., renames `auth:signIn` to something else, or replaces the action-based flow with HTTP endpoints).

---

## 14. RELATED DEPENDENCIES

When upgrading `@convex-dev/auth`, also check compatibility with:

| Package | Current | Role | Risk |
|---|---|---|---|
| `convex` | ^1.32.0 | Core Convex client + `ConvexHttpClient` | Low — stable API |
| `convex-svelte` | ^0.0.12 | `setupConvex()`, `useConvexClient()`, `useQuery()` | Low — we only use basic features |
| `@auth/core` | 0.37.0 | OAuth provider definitions (e.g., `Google`) | Medium — `@convex-dev/auth` may require a specific range |

Check `@convex-dev/auth`'s `peerDependencies` in its `package.json` to verify compatibility:
```bash
npm view @convex-dev/auth@NEW_VERSION peerDependencies
```

---

## 15. QUICK REFERENCE — COMMANDS

```bash
# Check for new version
npm view @convex-dev/auth version

# Check peer dependency compatibility
npm view @convex-dev/auth@NEW_VERSION peerDependencies

# Install specific version
npm install @convex-dev/auth@NEW_VERSION --save-exact

# Run contract smoke test
npm run test:auth

# Run TypeScript check
npx svelte-check --tsconfig ./tsconfig.json

# Push Convex functions
npx convex dev --once

# Start dev server for manual testing
npm run dev
```
