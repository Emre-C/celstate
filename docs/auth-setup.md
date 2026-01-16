# Convex Auth Setup Guide

## Environment Variables

Convex Auth requires these environment variables configured in the **Convex Dashboard** (not `.env.local`).
Pipeline sync uses a service key that must be set in both the Convex Dashboard and the environment running the Python pipeline.

### Required Variables

| Variable | Description | Where to Set |
|----------|-------------|--------------|
| `SITE_URL` | Frontend origin for OAuth redirects | Convex Dashboard |
| `JWT_PRIVATE_KEY` | RSA private key for signing JWTs | Convex Dashboard |
| `JWKS` | JSON Web Key Set for token verification | Convex Dashboard |
| `AUTH_GOOGLE_ID` | Google OAuth Client ID | Convex Dashboard |
| `AUTH_GOOGLE_SECRET` | Google OAuth Client Secret | Convex Dashboard |

### Service Sync Variables

| Variable | Description | Where to Set |
|----------|-------------|--------------|
| `SERVICE_KEY` | Shared secret for service-only mutations | Convex Dashboard + Python environment |
| `CONVEX_URL` | Convex deployment URL (Python client) | Python environment |
| `CONVEX_SYNC_ENABLED` | true/false/auto (auto = enable if CONVEX_URL set) | Python environment |
| `CONVEX_SYNC_STRICT` | true/false (default true) | Python environment |
| `CONVEX_UPLOAD_TIMEOUT_SECONDS` | Upload timeout in seconds | Python environment |

### Generating JWT Keys

Run the key generation script from the project root:

```bash
node generateKeys.mjs
```

Copy the output values to your Convex dashboard.

---

## Google OAuth Setup

### 1. Create OAuth Client

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new OAuth 2.0 Client ID (Web application)
3. Configure the following:

### 2. Authorized JavaScript Origins

| Environment | Origin |
|-------------|--------|
| Local Dev | `http://localhost:5173` |
| Production | `https://yourdomain.com` |

### 3. Authorized Redirect URIs

| Environment | Redirect URI |
|-------------|--------------|
| All | `https://<your-deployment>.convex.site/api/auth/callback/google` |

> Replace `<your-deployment>` with your Convex deployment name (found in `.env.local` as `CONVEX_URL`).

### 4. Copy Credentials

- Copy **Client ID** → `AUTH_GOOGLE_ID` in Convex Dashboard
- Copy **Client Secret** → `AUTH_GOOGLE_SECRET` in Convex Dashboard

---

## Environment Configuration by Stage

### Local Development

Set in **Convex Dashboard** (not local files—Convex pulls env vars server-side):

```
SITE_URL=http://localhost:5173
JWT_PRIVATE_KEY=<from generateKeys.mjs>
JWKS=<from generateKeys.mjs>
AUTH_GOOGLE_ID=<from Google Cloud Console>
AUTH_GOOGLE_SECRET=<from Google Cloud Console>
SERVICE_KEY=<random-long-secret>
```

Frontend `.env.local` (for Vite):

```
VITE_CONVEX_URL=<your convex deployment URL>
```

Python pipeline environment:

```
CONVEX_URL=<your convex deployment URL>
SERVICE_KEY=<same value as Convex Dashboard>
CONVEX_SYNC_ENABLED=auto
CONVEX_SYNC_STRICT=true
CONVEX_UPLOAD_TIMEOUT_SECONDS=30
```

### Production

Same variables in Convex Dashboard, but update:

```
SITE_URL=https://yourdomain.com
SERVICE_KEY=<random-long-secret>
```

Production pipeline environment:

```
CONVEX_URL=<your convex deployment URL>
SERVICE_KEY=<same value as Convex Dashboard>
CONVEX_SYNC_ENABLED=true
CONVEX_SYNC_STRICT=true
CONVEX_UPLOAD_TIMEOUT_SECONDS=30
```

---

## Verification Checklist

- [ ] `node generateKeys.mjs` runs successfully
- [ ] JWT_PRIVATE_KEY and JWKS added to Convex Dashboard
- [ ] Google OAuth client created with correct origins/redirects
- [ ] AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET added to Convex Dashboard
- [ ] SITE_URL matches your frontend origin
- [ ] `npx convex dev` starts without auth errors
