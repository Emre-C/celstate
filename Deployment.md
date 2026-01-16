# Deployment (Cloudflare Pages + Convex + Namecheap)

This is the authoritative, step-by-step production deployment runbook for **celstate.com**.

## 0) Prerequisites (accounts + access)

- Cloudflare account with access to **Pages**.
- Convex account with access to create a **production** deployment.
- Google Cloud Console access to create OAuth credentials.
- Namecheap access for DNS changes on **celstate.com**.

## 1) Convex production deployment

1. From the repo root, deploy Convex to production:
   ```bash
   npx convex deploy --prod
   ```
2. In the Convex dashboard, note your **production deployment URL** (used by the web app):
   - Example format: `https://<deployment>.convex.cloud`

## 2) Generate JWT keys (one-time)

1. From the repo root:
   ```bash
   node generateKeys.mjs
   ```
2. Copy the output values (do **not** commit them):
   - `JWT_PRIVATE_KEY`
   - `JWKS`

## 3) Configure Convex environment variables

Set these in the **Convex Dashboard** for the **production** deployment:

- `SITE_URL=https://www.celstate.com`
- `JWT_PRIVATE_KEY=<from generateKeys.mjs>`
- `JWKS=<from generateKeys.mjs>`
- `AUTH_GOOGLE_ID=<from Google OAuth client>`
- `AUTH_GOOGLE_SECRET=<from Google OAuth client>`
- `SERVICE_KEY=<random-long-secret>`

> Note: `SERVICE_KEY` must also be set in any environment running the Python pipeline.

## 4) Configure Google OAuth

1. In Google Cloud Console, create an **OAuth Client ID** (Web application).
2. Set **Authorized JavaScript origins**:
   - `https://www.celstate.com`
3. Set **Authorized redirect URIs**:
   - `https://<deployment>.convex.site/api/auth/callback/google`
4. Copy credentials into Convex:
   - Client ID → `AUTH_GOOGLE_ID`
   - Client Secret → `AUTH_GOOGLE_SECRET`

## 5) Cloudflare Pages (frontend hosting)

1. Create a **Cloudflare Pages** project for this repo.
2. Configure the build:
   - **Build command**:
     ```bash
     npm --prefix web install
     npm --prefix web run build
     node scripts/build_static.mjs
     ```
   - **Build output directory**: `dist`
3. Add **build-time environment variables** in Cloudflare Pages:
   - `VITE_CONVEX_URL=<your Convex production deployment URL>`

> The build outputs `dist/landing/` and `dist/app/`, and creates `dist/index.html` that redirects `/` → `/landing/`.

## 6) Custom domain (Namecheap → Cloudflare Pages)

**Recommended:** use `www.celstate.com` as the canonical domain and redirect apex to `www`.

1. In Cloudflare Pages, add **Custom Domain**: `www.celstate.com`.
2. Cloudflare will provide DNS records. In Namecheap DNS:
   - Add CNAME:
     - Host: `www`
     - Value: `<project>.pages.dev`
3. Add a **URL Redirect** in Namecheap for the apex:
   - `celstate.com` → `https://www.celstate.com`

> Alternative: move DNS to Cloudflare if you want apex `@` directly.

## 7) Production verification

1. Visit `https://www.celstate.com/landing/` and confirm the landing page loads.
2. Visit `https://www.celstate.com/app/` and sign in with Google.
3. Confirm sign-out works.
4. In Convex dashboard, confirm auth tables (users, sessions) populate.

## 8) (Optional) Pipeline environment

If the Python pipeline is running in production, set these environment variables:

```
CONVEX_URL=<your Convex production deployment URL>
SERVICE_KEY=<same value as Convex dashboard>
CONVEX_SYNC_ENABLED=true
CONVEX_SYNC_STRICT=true
CONVEX_UPLOAD_TIMEOUT_SECONDS=30
```
