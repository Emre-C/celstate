# Audit 07: Remove Deprecated, Legacy, and Fallback Code

**Date:** 2026-06-24  
**Scope:** `src/`  
**Tools:** grep, manual code review

---

## Summary

The codebase has several legacy code paths from the WorkOS→Clerk auth migration and the retired animation generation system. Some are necessary (pending prod data cleanup), others are dead weight.

---

## Findings

### 1. `workosUserId` field in schema + migration code ✅ IMPLEMENTED

**Files:**
- ~~`src/convex/schema.ts:38-39` — `workosUserId: v.optional(v.string())`~~ **Removed.**
- ~~`src/convex/users.ts:496-534` — `clearWorkosUserIdPage` + `clearWorkosUserId`~~ **Removed.**

**Status:** **Prod migration verified and code removed.** `pnpm exec convex run --prod internal.users.clearWorkosUserId` cleared 4 rows (20 total users, 0 remaining with `workosUserId`). The field has been dropped from `schema.ts` and both `clearWorkosUserIdPage`/`clearWorkosUserId` migration functions deleted from `users.ts`.

### 2. `referenceStorageId` (singular) — legacy single-image field ✅ IMPLEMENTED

**Files:**
- ~~`src/convex/schema.ts:66` — `referenceStorageId: v.optional(v.id("_storage"))`~~ **Removed.**
- ~~`src/convex/lib/referenceStorageIds.ts:3-12` — `mergedReferenceStorageIds()` legacy merge~~ **Simplified** to return `generation.referenceStorageIds ?? []`.
- ~~`src/convex/lib/generationArtifactStorage.ts:43` — `push(gen.referenceStorageId)`~~ **Removed.**
- ~~`src/convex/generations.ts:964-1009` — `backfillReferenceStorageIdPage` + `backfillReferenceStorageId`~~ **Removed.**
- ~~`src/convex/generations.ts:58-62, 759-763` — `referenceStorageId` in inline validators~~ **Removed.**
- ~~`src/convex/lib/referenceStorageIds.test.ts` — 3 legacy test cases~~ **Updated** — legacy tests removed, 2 tests remain.

**Status:** **Prod verified and code removed.** `pnpm exec convex run --prod --inline-query` confirmed 0 generations have the singular `referenceStorageId` field set (34 total generations). The field has been dropped from `schema.ts`, both backfill migration functions deleted from `generations.ts`, `mergedReferenceStorageIds` simplified, `storageIdsFromGeneration` updated, and tests updated.

### 3. `animationGenerations` table + all animation-specific code — retired but retained ✅ IMPLEMENTED

**Status:** **Prod verified and fully removed.** `pnpm exec convex run --prod --inline-query` confirmed 0 rows in `animationGenerations` table. All associated code has been removed in a single coordinated change:
- Dropped table definition (6 indexes) from `schema.ts`
- Deleted all 12 animation-specific validators from `validators.ts`
- Removed `storageIdsFromAnimationGeneration()`, `isTerminalAnimationGenerationStatus()`, `isAnimationGenerationEligibleForRetentionPurge()` from `generationArtifactStorage.ts`
- Removed `deleteAnimationGenerationRow()` and `deleteAnimationGenerationsForUser()` from `userArtifactDeletion.ts`
- Removed `purgeExpiredAnimationGenerations()` and `animationGenerationsRemoved` return field from `generationArtifactRetention.ts`
- Removed `animationGenerationsRemoved` return field and `deleteAnimationGenerationsForUser` call from `qaUserReset.ts`
- Removed `animationGenerations` repoint loop from `mergeUserInto` in `users.ts`
- Removed animation-specific test cases from `generationArtifactStorage.test.ts` and `users.provisioning.test.ts`

### 4. WorkOS→Clerk cutover merge logic — KEEP (prod data still requires it)

**Files:**
- `src/convex/users.ts:64-114` — `lookupUsersForIdentity` with email/token/clerkUserId triple lookup
- `src/convex/users.ts:132-242` — `mergeUserInto` consolidates cutover shells
- `src/convex/users.ts:244-317` — `upsertUserRecord` with duplicate consolidation

**Status:** **Prod data verified — merge logic must stay.** `pnpm exec convex run --prod --inline-query` confirmed 12 of 20 users still lack `clerkUserId`. These are legacy WorkOS accounts that haven't yet signed in via Clerk. The triple-lookup (`clerkUserId` + `tokenIdentifier` + `email`) and `mergeUserInto` consolidation are still actively needed to bind these users to Clerk identities when they eventually sign in.

**Recommendation:** Keep until all prod users have `clerkUserId` set. Re-check periodically with `pnpm exec convex run --prod --inline-query "const users = await ctx.db.query('users').collect(); return users.filter(u => !u.clerkUserId).length"`. Once 0 users lack `clerkUserId`, simplify to a single `clerkUserId` lookup and remove `mergeUserInto`.

### 5. `resolveAuthProviderFromIdentity` — WorkOS connection type fallback ✅ IMPLEMENTED

**File:** `src/convex/users.ts:36-43`

**Status:** ~~The `connection_type` / `connectionType` field is a WorkOS identity field. Clerk uses a different identity shape.~~ **Verified and removed.** The Clerk JWT template only provides `aud`, `email`, and `email_verified` (see `docs/product/authentication.md`). `connection_type` is a WorkOS field that is never present in Clerk identities. The dead `connection_type` / `connectionType` check has been removed. The email-based Apple detection (`@privaterelay.appleid.com`) is retained. `docs/product/authentication.md` line 104 updated to remove the `connection_type` reference.

### 6. `signInFallbackRedirectUrl` / `signUpFallbackRedirectUrl` in ClerkProvider

**File:** `src/routes/+layout.svelte:53-54`

```svelte
signInFallbackRedirectUrl="/app"
signUpFallbackRedirectUrl="/app"
```

**Status:** These are Clerk configuration props, not legacy code. They define where to redirect after sign-in/sign-up if no `returnTo` was specified. This is current and correct.

**Verdict:** Not legacy. No change needed.

### 7. `ResolvedAuthProvider` includes `'unknown'` fallback

**File:** `src/lib/auth/providers.ts:4-8`

```typescript
/**
 * The auth provider actually attached to a given user, including `'unknown'`
 * for the fallback case where identity metadata does not resolve to a
 * recognised provider (e.g. legacy accounts, rare upstream shapes).
 */
export type ResolvedAuthProvider = AuthProviderId | 'unknown';
```

**Status:** The `'unknown'` variant exists for legacy accounts that don't have a recognizable provider. Once all prod accounts have been through Clerk sign-in, this fallback may be unnecessary.

**Recommendation:** Keep for now — it's a safe default. Can be revisited after the cutover is complete.

### 8. `fallback` export in MCP route

**File:** `src/routes/mcp/+server.ts:32`

```typescript
export const fallback = handleMcpRoute;
```

**Status:** This is a SvelteKit `fallback` export for unmatched HTTP methods, not legacy code. It's the correct way to handle all methods on a SvelteKit server route.

**Verdict:** Not legacy. No change needed.

### 9. Stale "JWT (legacy)" reference in cron comment ✅ IMPLEMENTED

**File:** `src/convex/crons.ts:47`

**Status:** ~~The comment references "JWT (legacy)" alongside current rotation items.~~ **Fixed.** The "JWT (legacy)" reference has been removed from the cron comment. Additionally, the dead `jwt` rotation group has been removed from `scripts/secrets/rotate.mjs` (no code in `src/` references `JWT_PRIVATE_KEY` or `JWKS`), `JWT_PRIVATE_KEY`/`JWKS` removed from `bootstrap-dev.mjs` `AUTO_ROTATED` set, and all JWT references removed from `scripts/secrets/README.md` and `docs/runbooks/SECRETS-MANAGEMENT.md`.

---

## Critical Assessment

The legacy code falls into three categories:

1. ~~**Data-dependent** (workosUserId, referenceStorageId, animationGenerations, cutover merge)~~ **✅ 3 of 4 resolved.** `workosUserId`, `referenceStorageId`, and `animationGenerations` all verified clean on prod and removed. Cutover merge logic **must stay** — 12 of 20 prod users still lack `clerkUserId`.

2. ~~**Code-dependent** (resolveAuthProviderFromIdentity connection_type check)~~ **✅ Resolved** — Verified Clerk JWT template doesn't provide `connection_type`; dead code removed.

3. ~~**Documentation** (crons.ts JWT comment)~~ **✅ Resolved** — Stale reference removed; dead `jwt` rotation group removed from scripts and docs.

All actionable findings have been implemented. The only remaining item is finding #4 (cutover merge), which is gated on legacy WorkOS users completing their first Clerk sign-in.

---

## Implementation Priority

| ~~High~~ ✅ | ~~Remove `animationGenerations` table + 12 validators + 3 storage helpers + purge + QA reset deletion + merge repoint~~ | ~~Wait for 30-day retention to clear prod rows~~ **Done — 0 rows on prod, all code removed** |
| ~~High~~ ✅ | ~~Remove `workosUserId` field + `clearWorkosUserId*` migration code~~ | ~~Verify `clearWorkosUserId` has run on prod~~ **Done — 4 rows cleared, field removed** |
| ~~Medium~~ ✅ | ~~Remove `referenceStorageId` singular field + `backfillReferenceStorageId*` migration + merge helper + storage helper line~~ | ~~Verify `backfillReferenceStorageId` has run on prod~~ **Done — 0 rows with singular field, all code removed** |
| Medium | Simplify cutover merge logic (`lookupUsersForIdentity`, `mergeUserInto`, `upsertUserRecord`) | 12 of 20 prod users still lack `clerkUserId` — keep until all are Clerk-bound |
