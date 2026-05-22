# WorkOS AuthKit Ship Checklist

> Semi-technical runbook. Run every step in order and record results. Do not skip.

## Prerequisites

- [ ] Doppler CLI installed and `doppler setup --project celstate --config dev` done.
- [ ] WorkOS Dashboard access (client ID, API key, Redirect URI settings visible).
- [ ] Convex Dashboard access (to inspect `users` rows).
- [ ] Chrome DevTools open (Network + Application → Cookies).

## 1. Local Gates

Run these commands in the repo root. Each must pass before proceeding.

```bash
pnpm test:auth
pnpm typecheck:tsc
pnpm check
pnpm lint:ts
```

**Expected**: all pass with zero errors.

## 2. Environment Shape Check

```bash
pnpm check:kit-server-env
```

**Expected**: `WorkOS AuthKit server env OK` without printing secret values.

## 3. Live WorkOS Sign-In Proof

### 3.1 Start the app with real WorkOS env

```bash
doppler run -- pnpm dev
```

### 3.2 Test the protected-route redirect

1. Open an **incognito** browser to `http://localhost:5173/app`.
2. **Verify**: redirect to `/api/auth/initiate?returnTo=%2Fapp`, then to WorkOS AuthKit (staging: `*.authkit.app`).

### 3.3 Test sign-in flow

1. From home, click **Start Generating** — you should **not** see a Celstate sign-in interstitial on the happy path.
2. Complete sign-in with Google on AuthKit.
3. **Verify**: callback lands back at `/app` without errors.
4. In DevTools **Application → Cookies**, confirm a cookie named `wos-session` exists with `HttpOnly; Secure` (or `Secure` matching your origin).

### 3.4 Test token endpoints

Open these URLs in the **same** browser session and record responses:

| Endpoint | Expected Response |
|---|---|
| `http://localhost:5173/api/auth/session` | `{"authenticated": true}` |
| `http://localhost:5173/api/auth/access-token` | `{"token": "eyJ..."}` (real JWT) |
| `http://localhost:5173/api/auth/convex-ready` | `{"ok": true, "userId": "..."}` |

**If any return `401` or `ok: false`, stop and investigate before shipping.**

## 4. Token Claim Verification

Copy the `token` value from `/api/auth/access-token`.

Paste it into a JWT debugger (e.g., `https://jwt.io`) **locally** or decode via a trusted script. Do **not** paste production tokens into public websites.

**Verify these claims exist and look reasonable:**

| Claim | Expected Value |
|---|---|
| `sub` | WorkOS user ID (starts with `user_`) |
| `sid` | Session ID (starts with `session_`) |
| `iss` | `https://api.workos.com/` |
| `aud` | Your `WORKOS_CLIENT_ID` |
| `iat` | Recent timestamp |
| `exp` | Future timestamp (default ~15 min) |

**Optional but recommended**: If the app needs email/name/image in Convex, verify these claims are present too:

| Claim | Notes |
|---|---|
| `email` | Only present if WorkOS JWT Template is configured |
| `email_verified` | Only present if JWT Template is configured |
| `name` / `picture` | Only present if JWT Template is configured |

**Decision**: If any required claim is missing, configure the WorkOS JWT Template in the dashboard before shipping. Do not ship with missing claims the app depends on.

## 5. Dashboard Configuration Verification

In the WorkOS Dashboard, verify these match your deployed origin exactly:

| Setting | Must Match |
|---|---|
| Redirect URI | `https://<your-origin>/callback` |
| Default Sign-in endpoint | `https://<your-origin>/api/auth/initiate` |
| Default Sign-out redirect | `https://<your-origin>/` (or `/auth`) |
| AuthKit domain (production) | `auth.celstate.com` (custom domain; staging uses `*.authkit.app`) |

**Important**: Mismatches here cause `redirect_uri_mismatch`, impersonation failures, or silent logout loops in production.

## 5b. AuthKit Branding (Production)

In WorkOS Dashboard → Branding, configure AuthKit to match Celstate design tokens:

| Token | Value |
|---|---|
| Page background | `#F5F3ED` (warm parchment) |
| Button / link accent | `#C2410C` (terracotta) |
| Appearance | Light only |
| Logo / favicon | Celstate brand assets |
| Copy | Editorial tone; no WorkOS-centric language |

Preview sign-in and sign-up pages after changes. Full reference: [`authentication.md`](../product/authentication.md) and [WorkOS AuthKit branding docs](https://workos.com/docs/authkit/branding).

## 6. User Provisioning Proof

In the Convex Dashboard, query the `users` table.

**Verify the signed-in user row contains:**

- `workosUserId` matching the JWT `sub`
- `tokenIdentifier` populated
- `email` normalized (if email claim is configured)
- `name` / `imageUrl` populated (if those claims are configured)
- Correct credit balance (if migrating from legacy auth, verify adoption preserved credits)

## 7. Sign-Out Proof

1. While signed in, visit `/sign-out`.
2. **Verify**: browser redirects to WorkOS logout, then back to your app.
3. In DevTools **Application → Cookies**, confirm the `wos-session` cookie is gone.
4. Try visiting `/app` again.
5. **Verify**: redirect to `/auth` (not a broken page or loop).

## 8. Canary Upgrade (Post-Ship Recommended)

Current canary is shallow (proves `/auth` renders and `/api/auth/session` returns JSON).

**Before considering auth fully operational:**

- [ ] Add an authenticated canary path using a pre-authenticated storage state, OR
- [ ] Add a WorkOS test-user browser automation probe, OR
- [ ] Document a manual weekly ritual: sign in → verify `/app` → sign out → verify redirect.

## 9. Final Gates Before Deploy

```bash
pnpm check:public-env
pnpm verify
```

**Expected**: all pass.

## Ship Decision

| Status | Action |
|---|---|
| All steps above pass | Ship |
| Any token endpoint returns 401 | Do not ship — debug env/session |
| Missing required JWT claims | Do not ship — configure WorkOS JWT Template first |
| Dashboard Redirect URI mismatch | Do not ship — fix in WorkOS dashboard |
| Sign-out does not clear cookie | Do not ship — debug `/sign-out` route |

**Record completion date and blocker status below:**

- Completed on: ___________
- Blockers found: ___________
- Blockers resolved: ___________
