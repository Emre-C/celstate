# Bug: Infinite Session Refresh Loop Causing 4096 Read Limit

## Date
2026-03-06

## Symptoms
- Massive stream of `refreshSession` logs (~1 call per second for 40+ seconds)
- Error: `Too many reads in a single function execution (limit: 4096)`
- Logout flow fails to complete

## Why We Investigated
User reported logout failing with excessive logging. Logs showed hundreds of `auth:store` type: refreshSession calls, eventually crashing with Convex's 4096 read limit exceeded error.

## What We Found

### Root Cause
**Client-side auth re-registration loop** in `src/lib/auth.svelte.ts`:

```typescript
// Line 55-68
function setTokens(jwt: string | null, refreshToken?: string | null, persist = true) {
  token = jwt;
  // ... storage logic ...
  
  // BUG: This re-registers auth on EVERY token change
  client.setAuth(fetchAccessToken);  // ← PROBLEM
  isLoading = false;
}
```

Every time tokens change (including during refresh), `setTokens()` re-registers the auth function with the Convex client. This triggers the `@convex-dev/auth` library's `store` mutation to validate/refresh the session, which then updates tokens, which calls `setTokens()` again, creating an infinite loop.

### Contributing Factor
The `store` mutation in `@convex-dev/auth` appears to perform unindexed queries on the sessions/identities table, causing excessive reads (hitting 4096 limit after ~40 iterations).

## Next Steps

1. **Fix auth re-registration loop** (`src/lib/auth.svelte.ts`)
   - Remove `client.setAuth(fetchAccessToken)` from `setTokens()` (line 67)
   - Auth function should only be set once at initialization (line 91)

2. **Add refresh guard** (optional hardening)
   - Track in-progress refresh to prevent concurrent refreshes
   - Add debouncing/throttling to avoid rapid re-authentication

3. **Verify logout flow**
   - Ensure logout properly clears tokens without triggering residual refresh

4. **Monitor for server-side issues** (if Step 1 doesn't fully resolve)
   - Check if `store` mutation needs indexes on `identities` or `sessions` tables
   - Consider pagination if scanning too many documents
