# Login Troubleshooting - January 16, 2026

## Current Problem

Clicking "Continue with Google" on https://www.celstate.com/app/ results in:
```
[CONVEX A(auth:signIn)] [Request ID: a3ee01d727cd50ee] Server Error
```

The `auth:signIn` Convex action is failing with an unspecified server error.

---

## What's Been Configured ✅

### Cloudflare Pages
- **Project**: `celstate` 
- **URL**: https://www.celstate.com
- **Build command**: `npm --prefix web install && npm --prefix web run build && node scripts/build_static.mjs`
- **Build output**: `dist`
- **Env var**: `VITE_CONVEX_URL=https://original-jackal-530.convex.cloud`
- **Custom domain**: www.celstate.com → celstate.pages.dev
- **Apex redirect**: celstate.com → https://www.celstate.com (Page Rule)

### Convex Production
- **Deployment**: https://original-jackal-530.convex.cloud
- **HTTP Actions**: https://original-jackal-530.convex.site

**Environment Variables Set:**
| Variable | Value |
|----------|-------|
| SITE_URL | https://www.celstate.com |
| JWT_PRIVATE_KEY | ✅ Set (RSA private key) |
| JWKS | ✅ Set (JSON Web Key Set) |
| SERVICE_KEY | ✅ Set |
| AUTH_GOOGLE_ID | 951791321388-sk0tmu2ha87cbcjl2udph5fq430p4jkr.apps.googleusercontent.com |
| AUTH_GOOGLE_SECRET | ✅ Set |

### Google OAuth (Google Cloud Console)
- **Authorized JavaScript origins**: `https://www.celstate.com`
- **Authorized redirect URIs**: `https://original-jackal-530.convex.site/api/auth/callback/google`

---

## Steps Taken

1. ✅ Created Cloudflare Pages project with GitHub integration
2. ✅ Set VITE_CONVEX_URL build environment variable
3. ✅ Configured custom domain (www.celstate.com)
4. ✅ Set up apex → www redirect
5. ✅ Generated JWT keys and set in Convex
6. ✅ Set all 6 required Convex environment variables
7. ✅ Deployed Convex functions to production (`npx convex deploy -y`)
8. ✅ Verified Google OAuth credentials match
9. ✅ Fixed App.tsx auth timeout handling
10. ✅ Triggered fresh Cloudflare deployment

---

## Root Cause (Likely)

The `auth:signIn` action is throwing a server error. This typically means:

1. **JWT_PRIVATE_KEY format issue** - The key may not have been set correctly (multiline handling)
2. **JWKS mismatch** - The JWKS public key doesn't match the private key
3. **Missing provider config** - Google provider might need explicit configuration

---

## Next Steps to Debug

### 1. Check Convex Logs
```bash
cd /Users/emre/Documents/codebase/active-projects/celstate
npx convex logs
```
Then try signing in again and watch for the actual error message.

### 2. Verify JWT Keys Match
Regenerate keys and set them atomically:
```bash
node generateKeys.mjs
# Copy JWT_PRIVATE_KEY and JWKS from output
npx convex env set JWT_PRIVATE_KEY '<paste-private-key>' --prod
npx convex env set JWKS '<paste-jwks>' --prod
```

### 3. Check Convex Dashboard for Errors
Visit: https://dashboard.convex.dev/d/original-jackal-530/production/logs

### 4. Test OAuth Callback Directly
```bash
curl -I "https://original-jackal-530.convex.site/api/auth/callback/google"
```
Should return 302 redirect.

### 5. Verify Auth Tables Exist
Check Convex Dashboard → Data tab for these tables:
- `users`
- `authAccounts`
- `authSessions`
- `authRefreshTokens`

---

## Credentials Reference (for re-configuration)

**Cloudflare Account ID**: `d2c9995638b5271234eb91f8ecfcdcc0`
**Cloudflare Zone ID** (celstate.com): `3c0166f25e08dba6547b4b542e30fc61`
**Convex Deployment**: `original-jackal-530`

---

## Files Modified This Session

- `web/src/App.tsx` - Added auth timeout handling (10s timeout to prevent infinite loading)

---

## Console Errors Observed

```
[CONVEX A(auth:signIn)] [Request ID: a3ee01d727cd50ee] Server Error
```

Additional noise (can be ignored):
- CSP inline script warning (Cloudflare analytics)
- CORS errors for cloudflareinsights beacon (analytics script)
- YouTube favicon 404 (Google sign-in page artifact)
