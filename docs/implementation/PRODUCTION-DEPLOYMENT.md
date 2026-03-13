# Production Deployment — Master Plan

> **Status**: Pre-production  
> **Last Updated**: 2026-03-11  
> **References**:  
> - [`PAYMENT-IMPLEMENTATION.md`](./PAYMENT-IMPLEMENTATION.md) — Stripe gaps, testing checklists  
> - [`VERCEL-DEPLOYMENT.md`](./VERCEL-DEPLOYMENT.md) — SvelteKit adapter swap, Vercel CLI steps

---

## Current State Audit

### CLIs Installed & Authenticated

| Tool | Version | Auth Status |
|------|---------|-------------|
| `vercel` | 50.31.1 | ✅ Logged in as 
| `stripe` | 1.37.2 | ✅ Logged in as `celstate_sandbox` — **test mode only**, no live mode key configured |
| `convex` | 1.32.0 | ✅ Logged in, both dev and prod deployments exist |

### Convex Dev Deployment — Environment Variables (complete)

| Variable | Status | Value |
|----------|--------|-------|
| `AUTH_GOOGLE_ID` | ✅ Set | `1033853...` (dev OAuth client) |
| `AUTH_GOOGLE_SECRET` | ✅ Set | (redacted) |
| `GEMINI_API_KEY` | ✅ Set | (redacted) |
| `HOSTING_URL` | ✅ Set | `http://localhost:5173` |
| `STRIPE_SECRET_KEY` | ✅ Set | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | ✅ Set | `whsec_...` (test) |
| `STRIPE_PRICE_STARTER` | ✅ Set | `price_1T9JXEADrsPdxsf7luMsEncJ` |
| `STRIPE_PRICE_PRO` | ✅ Set | `price_1T9JXFADrsPdxsf7jkGzXunA` |
| `JWKS` | ✅ Set | (auto-generated) |
| `JWT_PRIVATE_KEY` | ✅ Set | (auto-generated) |
| `SERVICE_KEY` | ✅ Set | (auto-generated) |
| `SITE_URL` | ✅ Set | `http://localhost:5173` |

### Convex Prod Deployment — Environment Variables (partial)

| Variable | Status | Value |
|----------|--------|-------|
| `AUTH_GOOGLE_ID` | ⚠️ **Stale** | `951791...` — orphaned client, must be replaced with `1033853...` |
| `AUTH_GOOGLE_SECRET` | ⚠️ **Stale** | Must be replaced with secret from the real client |
| `JWKS` | ✅ Set | (auto-generated, different from dev) |
| `JWT_PRIVATE_KEY` | ✅ Set | (auto-generated) |
| `SERVICE_KEY` | ✅ Set | (auto-generated) |
| `SITE_URL` | ✅ Set | `https://www.celstate.com` |
| `CONVEX_SITE_URL` | ✅ Set | `https://original-jackal-530.convex.site` |
| `GEMINI_API_KEY` | ❌ **Missing** | |
| `STRIPE_SECRET_KEY` | ❌ **Missing** | |
| `STRIPE_WEBHOOK_SECRET` | ❌ **Missing** | |
| `STRIPE_PRICE_STARTER` | ❌ **Missing** | |
| `STRIPE_PRICE_PRO` | ❌ **Missing** | |
| `HOSTING_URL` | ❌ **Missing** | |

### Stripe Account

- Account ID: `acct_1T9JMmADrsPdxsf7`
- Test products exist: **Celstate Starter Pack** (`prod_U7YetcZZrGxaNu`) and **Celstate Pro Pack** (`prod_U7YeHHRz1pSUT5`)
- `livemode: false` — **live mode activation status unknown** (requires Stripe Dashboard)

### Frontend Code

- `svelte.config.js`: Still using `@sveltejs/adapter-auto` — needs swap to `@sveltejs/adapter-vercel`
- `src/routes/(app)/app/credits/+page.svelte`: Hardcoded test price IDs on lines 17–18

### Domain

- `SITE_URL` in Convex prod is already `https://www.celstate.com` — domain intent is confirmed

---

## Phase 1 — Human-Only Steps

These are the things the AI **cannot do** — they require identity verification, bank account linking, OAuth consent screens, domain registrar login, or Vercel account linking via browser.

### Step 1: Verify Stripe Live Mode is Active

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Settings → Account details**
2. If your account is still in test-only mode, complete business verification (legal name, address, bank account, tax ID)
3. **What to check**: The top-right toggle should let you switch between "Test mode" and "Live mode". If "Live mode" is grayed out or says "Activate", complete the verification flow
4. **Done when**: You can toggle to Live mode and see an empty dashboard (no test data)

> **Why you**: Identity verification, legal agreements, bank account linking. No API/CLI for this.

### Step 2: Create Live Stripe Products & Prices

1. In Stripe Dashboard, **toggle to Live mode** (top-right)
2. Go to **Products → + Add product**:
   - **Celstate Starter Pack** — Price: $5.00 USD, One-time. Save.
   - **Celstate Pro Pack** — Price: $10.00 USD, One-time. Save.
3. After creating each, click into the product → find the **Price** section → copy the **Price ID** (format: `price_...`)

> **Why you**: Product creation in live mode requires the Stripe Dashboard with an activated account. The AI's Stripe CLI is only authenticated for test mode.

**Record**:
```
STRIPE_PRICE_STARTER_LIVE=price_1T9zJgADZK8Hnf4rDqrfK6dF (product_id = prod_U8FpFK3I2sQieg)
STRIPE_PRICE_PRO_LIVE=price_1T9zKyADZK8Hnf4rtXt1wS8R (product_id = prod_U8Fqjw0rhwpNol)
```

### Step 3: Copy Live Stripe Secret Key

1. Stripe Dashboard → ensure you're in **Live mode**
2. Go to **Developers → API keys**
3. Under **Secret key**, click **Reveal live key** → copy it

> **Why you**: The live secret key requires dashboard authentication. The AI's CLI config only has `test_mode_api_key`.

**Record**:
```
STRIPE_SECRET_KEY_LIVE=sk_live_...
```

### Step 4: Google OAuth — Add Production Redirect URI

You have **one** OAuth client (`1033853029965-k172lrd09s3saq0tgdnl6ku52jhdmr4b.apps.googleusercontent.com`). Convex prod currently has a stale/orphaned client ID (`951791321388-...`) that no longer exists — the AI will fix this by updating `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in Convex prod to match the real client.

Your job is to add the production redirect URI to the existing client:

1. Go to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Click on the OAuth 2.0 client `1033853029965-...`
3. Under **Authorized redirect URIs**, keep the existing dev URI and **add**:
   ```
   https://original-jackal-530.convex.site/api/auth/callback/google
   ```
   (You should now have two redirect URIs — one for dev, one for prod)
4. Under **Authorized JavaScript origins**, **add**:
   ```
   https://www.celstate.com
   https://celstate.com
   ```
5. Click **Save**

> **Why you**: Google Cloud Console requires your Google account.  
> **AI will handle**: Updating `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in Convex prod to use the correct (only) client. One OAuth client with multiple redirect URIs is the standard pattern.

**Record**:
```
GOOGLE_OAUTH_PROD_REDIRECT_ADDED=yes
```

### Step 5: Vercel Account — Login via Browser

The Vercel CLI is installed (v50.31.1) but **not logged in**. The first login requires a browser-based OAuth flow:

1. In your terminal, run: `vercel login`
2. This opens a browser — sign in with your Vercel account (GitHub SSO or email)
3. Confirm the CLI shows your account name

After this one-time login, the AI can use `vercel` CLI for everything else.

> **Why you**: First-time CLI auth requires browser OAuth. Once done, the token persists and the AI can use all `vercel` commands.

**Record**:
```
VERCEL_LOGGED_IN=yes
```

### Step 6: Domain DNS (Namecheap → Vercel)

After the AI runs `vercel domains add celstate.com`, Vercel will output the required DNS records. You need to set them in Namecheap:

- **Option A (recommended)**: Set nameservers to Vercel's nameservers (Vercel will show them)
- **Option B**: A record `@` → `76.76.21.21`, CNAME `www` → `cname.vercel-dns.com`

> **Why you**: Domain registrar login. The AI will tell you exactly what records to set after running the domain commands.
> **Note**: This step happens **during** Phase 2 — the AI will pause and tell you what records to add.

### Step 7: ~~Stripe CLI Live Mode Authentication~~ — NOT NEEDED

The Stripe CLI does **not** have a separate live login flow. Instead, live commands use either:
- The `--live` flag on individual commands (e.g. `stripe webhook_endpoints create --live`) — this works automatically if the CLI is logged in (which it already is)
- Or `--api-key sk_live_...` passed directly to a command

Since the CLI is already authenticated (`stripe config --list` shows `acct_1T9JMmADrsPdxsf7`), the AI can run live commands by passing `--live` or `--api-key`. **No action needed from you.**

---

### Handoff Block

Complete Steps 1–7 above, fill in the values, and paste this to the AI:

```
# === STRIPE LIVE ===
STRIPE_SECRET_KEY_LIVE=sk_live_...
STRIPE_PRICE_STARTER_LIVE=price_...
STRIPE_PRICE_PRO_LIVE=price_...

# === VERCEL ===
VERCEL_LOGGED_IN=yes

# === GOOGLE OAUTH ===
GOOGLE_OAUTH_PROD_REDIRECT_VERIFIED=yes

# === GEMINI ===
# Same API key as dev, or a separate prod key if you have one:
GEMINI_API_KEY_PROD=...

# === DOMAIN ===
# DNS will be handled interactively during Phase 2
```

---

## Phase 2 — AI Assistant Execution

Everything below is executed by the AI using CLIs. No browser or dashboard access needed.

### 2.1 Code Changes

#### 2.1.1 Adapter Swap

**Current**: `svelte.config.js` imports `@sveltejs/adapter-auto`  
**Target**: `@sveltejs/adapter-vercel` v6.3.3 (latest stable, supports Node 22/24, SvelteKit 2.50+)

```bash
pnpm add -D @sveltejs/adapter-vercel
pnpm remove @sveltejs/adapter-auto
```

Update `svelte.config.js`:
```js
import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter()
  }
};

export default config;
```

**2026 best practice** (from Vercel + SvelteKit docs):
- Do NOT pass `runtime` option — it's deprecated. Node version is controlled via Vercel project settings (defaults to Node 22+)
- Do NOT use `split: true` — single function reduces cold starts
- Do NOT add `vercel.json` — SvelteKit handles all routing
- Calling `adapter()` with no options is the correct default config

**Verify**: `pnpm build` succeeds.

#### 2.1.2 Price IDs from Convex Env (Gap 1.1 from PAYMENT-IMPLEMENTATION.md)

Create a new Convex query `getStripePriceIds` that reads `STRIPE_PRICE_STARTER` and `STRIPE_PRICE_PRO` from Convex env vars. The credits page calls this query instead of hardcoding price IDs.

This ensures the same frontend build works against both dev (test prices) and prod (live prices) Convex deployments.

#### 2.1.3 Weekly Drip Audit Trail (Gap 1.2 from PAYMENT-IMPLEMENTATION.md)

In `grantWeeklyCredit`, insert a `creditGrants` row with `reason: "weekly_drip"` after patching each user's credits.

#### 2.1.4 Verify Build

```bash
pnpm build
pnpm check
```

### 2.2 Convex Production Deploy

The prod deployment already exists at `https://original-jackal-530.convex.site`. Auth env vars are already set. Deploy the latest code:

```bash
npx convex deploy
```

This pushes to the production deployment associated with the current project (resolved via `CONVEX_DEPLOYMENT` in `.env.local`).

**2026 Convex best practice**: `npx convex deploy` (without `--prod` flag) targets the production deployment of the project that `CONVEX_DEPLOYMENT` belongs to. The `--prod` flag is only for `npx convex env` and `npx convex run` commands.

Then set the missing env vars:

```bash
# Fix stale OAuth client (use same client as dev)
npx convex env set AUTH_GOOGLE_ID "1033853029965-k172lrd09s3saq0tgdnl6ku52jhdmr4b.apps.googleusercontent.com" --prod
npx convex env set AUTH_GOOGLE_SECRET "<same secret as dev>" --prod

# Stripe + Gemini
npx convex env set STRIPE_SECRET_KEY "sk_live_..." --prod
npx convex env set STRIPE_PRICE_STARTER "price_..." --prod
npx convex env set STRIPE_PRICE_PRO "price_..." --prod
npx convex env set HOSTING_URL "https://www.celstate.com" --prod
npx convex env set GEMINI_API_KEY "..." --prod
# STRIPE_WEBHOOK_SECRET set after step 2.3
```

### 2.3 Stripe Live Webhook

Create a permanent webhook endpoint pointing at the Convex prod HTTP endpoint:

```bash
stripe webhook_endpoints create \
  --url="https://original-jackal-530.convex.site/stripe/webhook" \
  --enabled-events="checkout.session.completed" \
  --live
```

The response JSON includes `"secret": "whsec_..."` — this is the signing secret.

```bash
npx convex env set STRIPE_WEBHOOK_SECRET "whsec_..." --prod
```

**2026 Stripe best practice**:
- Use `stripe webhook_endpoints create` for permanent endpoints (not `stripe listen` which is for local dev forwarding only)
- The `--live` flag targets live mode. Requires `stripe login --live` (Step 7 above)
- Only subscribe to `checkout.session.completed` — that's the only event `http.ts` handles
- The `whsec_...` in the response is the **only time** the full secret is shown; Stripe Dashboard shows it too but only via "Click to reveal"

### 2.4 Vercel Deploy

```bash
# Link project (interactive — AI confirms settings)
vercel link

# Set the one env var Vercel needs
vercel env add PUBLIC_CONVEX_URL production
# Value: https://original-jackal-530.convex.cloud (note: .cloud, not .site)

vercel env add PUBLIC_CONVEX_URL preview
# Same value

# Add custom domains
vercel domains add celstate.com
vercel domains add www.celstate.com

# >>> PAUSE: AI tells you the DNS records to set in Namecheap (Step 6) <<<
# >>> After DNS propagation: <<<

vercel domains inspect celstate.com  # verify DNS + TLS

# Deploy to production
vercel deploy --prod
```

**2026 Vercel CLI best practice** (from Vercel docs, updated March 2026):
- `vercel deploy --prod` (not `vercel --prod`) is the current recommended command
- `vercel env add` prompts for the value interactively — never passes secrets as CLI args
- `vercel domains inspect` checks DNS resolution + TLS certificate status
- No `vercel.json` needed for SvelteKit — the adapter handles Build Output API generation
- `PUBLIC_CONVEX_URL` uses `.convex.cloud` (client RPCs), NOT `.convex.site` (HTTP actions)

### 2.5 Post-Deploy Verification (AI-automated)

```bash
# Site responds
curl -I https://www.celstate.com   # → 200
curl -I https://celstate.com       # → 301/308 redirect to www

# Vercel env check
vercel env ls   # PUBLIC_CONVEX_URL in Production + Preview, nothing else

# Convex prod env check — no test keys in prod
npx convex env get STRIPE_SECRET_KEY --prod   # must start with sk_live_
npx convex env get HOSTING_URL --prod         # must be https://www.celstate.com
```

---

## Phase 3 — Manual Validation (You)

After Phase 2 completes, perform these tests in your browser:

| # | Test | What to verify | Est. time |
|---|------|---------------|-----------|
| 1 | **Google Sign-in** | Visit `https://www.celstate.com` → sign in with Google → user appears in Convex prod DB with initial credits | 1 min |
| 2 | **Stripe Live Checkout** | `/app/credits` → Buy Starter ($5 real card) → Stripe Checkout → redirect back → credits +15 → `creditGrants` row in Convex prod | 2 min |
| 3 | **Refund test payment** | Stripe Dashboard (live) → find payment → Refund → get $5 back | 1 min |
| 4 | **Generation end-to-end** | Run one generation → Gemini produces image → credit deducted | 1 min |
| 5 | **Insufficient credits** | Set credits to 0 in Convex Dashboard → try generating → clear error message, no deduction | 1 min |

---

## Dependency Graph

```
You: Steps 1-5 (Stripe, Google, Vercel login) ─── can be done in parallel
You: Step 7 (Stripe CLI live auth)
         │
         ▼
    Paste Handoff Block to AI
         │
         ├── 2.1  Code changes (adapter, price IDs, audit trail)
         ├── 2.1.4 Build verification
         │
         ├── 2.2  Convex deploy + env vars
         ├── 2.3  Stripe webhook creation → webhook secret → Convex env
         │
         ├── 2.4  Vercel link + env + domains
         │   └── PAUSE → You: Step 6 (DNS records in Namecheap)
         │   └── RESUME → Vercel deploy --prod
         │
         └── 2.5  Automated verification
         │
         ▼
    You: Phase 3 manual validation (5 tests, ~6 minutes)
```

---

## Security Invariants

- Vercel has **zero secrets** — only `PUBLIC_CONVEX_URL` (a public endpoint)
- Stripe keys, webhook secret, Gemini key live **only in Convex** env vars
- Frontend bundle contains no secret keys (enforced by SvelteKit's `$env/static/public` — only `PUBLIC_` prefixed vars are client-accessible)
- Convex prod must have `sk_live_`, never `sk_test_`
- Stripe webhook points at Convex (`*.convex.site`), never at Vercel

---

## Rollback

| System | How |
|--------|-----|
| Vercel | `vercel rollback` — instant, previous deployment goes live |
| Convex | Re-deploy from git: `npx convex deploy` after `git checkout <last-good-commit>` |
| Stripe | Disable webhook in Dashboard → Webhooks → toggle endpoint off |
| DNS | Revert records in Namecheap (propagation delay applies) |
