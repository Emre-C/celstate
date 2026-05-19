# Manual secret rotation — vendor dashboard click-paths

**Audience:** the human operator. **When to use:** any time you need to
rotate a secret that has no programmatic CLI rotation path. As of 2026-Q2
that's four secrets: two Stripe keys, the Google OAuth client secret, and
the Discord ops webhook URL.

For everything else (JWT / signing keys, WorkOS kit secrets, Verification
Runner, Vertex service account), use the scripts described in
[`SECRETS-MANAGEMENT.md`](./SECRETS-MANAGEMENT.md). Those don't require
clicking through any vendor UI.

> **Before you start.** Open the Doppler `prd` config in another tab so you
> can paste each new value as soon as you see it:
> <https://dashboard.doppler.com/workplace/996778d64be8993d9993/projects/celstate/configs/prd>
>
> When pasting, click **`+ ADD A SECRET`** in Doppler if the name doesn't
> exist yet, or click the existing row and **Edit value** if it does.

---

## Order of operations

Rotate in this order — broadest-blast-radius first.

1. [Stripe — secret API key](#1-stripe--secret-api-key) (`STRIPE_SECRET_KEY`)
2. [Stripe — webhook signing secret](#2-stripe--webhook-signing-secret) (`STRIPE_WEBHOOK_SECRET`)
3. [Google — OAuth client secret](#3-google--oauth-client-secret) (`AUTH_GOOGLE_SECRET`)
4. [Discord — ops webhook URL](#4-discord--ops-webhook-url) (`OPS_ALERT_WEBHOOK_URL`)

After **all four** are saved in Doppler, run the final sync from a terminal
in the repo root:

```pwsh
pnpm secrets:sync:convex -- --prune
```

The `--prune` flag also deletes any orphan vars present in Convex prod but
not in Doppler (e.g. `SERVICE_KEY` from the original 2026-04 leak audit).

---

## 1. Stripe — secret API key

Rotates `STRIPE_SECRET_KEY` (`sk_live_…`).

The 2026 Stripe Dashboard exposes API key rotation through the **API keys**
tab, with an explicit **Rotate key** action that supersedes the older
"Roll" terminology.

1. Open <https://dashboard.stripe.com/apikeys>.
2. Confirm the dashboard mode (top-right corner). It must read **`Live`**,
   not `Test mode` / `Sandbox`. Toggle if needed.
3. Find the row for your **Secret key** (label "Secret key", value starts
   with `sk_live_`).
4. Click the **`⋯`** overflow menu at the right end of that row.
5. Click **Rotate key**.
6. In the **Expiration** dropdown, choose **`Now`** (this revokes the old
   key immediately; the leaked value is dead from this point onward).
7. Click **Rotate API key**.
8. Stripe shows the new key value once. Click the value to copy.
9. *(Optional)* In the **Add a note** field, type `Doppler-managed`. Click
   **Save** or **Done**.
10. **Doppler:** open the `prd` config tab, click **`+ ADD A SECRET`**,
    name `STRIPE_SECRET_KEY`, paste the value, click **Save**. (If the
    secret already exists in Doppler from a previous attempt, click the
    row and use **Edit value** instead.)

> **Important.** Stripe shows the secret only once at creation. If you
> close the page before saving to Doppler, you must rotate again. Do not
> store the value anywhere else.

## 2. Stripe — webhook signing secret

Rotates `STRIPE_WEBHOOK_SECRET` (`whsec_…`). Used to verify that incoming
webhook payloads originated from Stripe.

In 2026 the webhook UI lives under **Workbench → Webhooks**, replacing the
older standalone "Webhooks" page.

1. Open <https://dashboard.stripe.com/webhooks>.
2. Confirm **`Live`** mode in the top-right.
3. Click the row for your endpoint (the URL pointing at the Convex HTTP
   action — likely `https://*.convex.site/stripe/webhook` or the
   `https://www.celstate.com` origin).
4. On the endpoint detail page, find the **Signing secret** section near
   the top.
5. Click the **`⋯`** overflow menu next to the signing secret.
6. Click **Roll secret**.
7. **Expiration policy:** choose **`Expire immediately`** (also labeled
   "Now" in some Stripe themes). Avoid the 24-hour delay option — leaked
   secrets must die immediately.
8. Click **Roll secret** to confirm.
9. Stripe reveals the new `whsec_…` value once. Click to copy.
10. **Doppler:** add/edit `STRIPE_WEBHOOK_SECRET` with the new value.

> **Important.** Stripe will start signing webhooks with the new secret
> immediately. Until you sync to Convex prod (the final step of this
> guide), Convex will reject incoming webhooks with a signature mismatch.
> This is a brief window — keep the order of operations and run the sync
> as soon as all four rotations are saved in Doppler.

## 3. Google — OAuth client secret

Rotates `AUTH_GOOGLE_SECRET` for the **Google OAuth client** used by your **WorkOS AuthKit** Google connection (pair with `AUTH_GOOGLE_ID` in Doppler). Update the secret in Google Cloud and Doppler whenever the client secret is rotated.

The Google Cloud UI was reorganized in 2025: OAuth client management moved
from **APIs & Services → Credentials** to the **Google Auth Platform**.
Both URLs work, but the Auth Platform URL is canonical and matches the new
support docs.

Google's 2025 client-secret rotation flow is a **two-step** process: add a
new secret, migrate to it, then disable + delete the old one. This avoids
downtime. (Reference: [Google Cloud Console help — Manage OAuth
Clients](https://support.google.com/cloud/answer/15549257?hl=en#rotate-secret).)

### Step A — Add a new secret

1. Open <https://console.developers.google.com/auth/clients>.
2. Confirm the project selector (top-left next to "Google Auth Platform")
   reads **`celstate-489304`**. Switch projects if not.
3. Under **OAuth 2.0 Client IDs**, click the row whose Client ID matches
   the value of `AUTH_GOOGLE_ID` in Doppler (it ends in
   `…dmr4b.apps.googleusercontent.com`).
4. On the client detail page, find the **Client secrets** panel on the
   right side.
5. Click **`Add Secret`**.
6. Google generates a new secret and shows it in **Enabled** state. Click
   the value to copy.
7. **Doppler:** add/edit `AUTH_GOOGLE_SECRET` with the new value.

> **Important.** Google now hashes client secrets after creation. The full
> value is **only visible at creation time**. After you close this page,
> only the last four characters are shown for identification. Save to
> Doppler immediately.

### Step B — Disable the old secret (after sync)

After you've completed the final `pnpm secrets:sync:convex --prune` and
verified that sign-in works with the new secret, return to the same
client detail page and disable the old secret:

1. Open <https://console.developers.google.com/auth/clients> → click the
   same client.
2. In the **Client secrets** panel, identify the older secret by its
   creation date.
3. Click **Disable** next to it. This invalidates the old secret within a
   few minutes.
4. Once you've confirmed nothing breaks for ~15 minutes, click **Delete**
   on the disabled secret.

If you skip this step, both secrets stay valid and the leaked one
remains a viable attack path.

## 4. Discord — ops webhook URL

`OPS_ALERT_WEBHOOK_URL`. Used by Convex actions to post ops alerts
(payment events, generation alerts, auth-canary failures) to the Discord
ops channel.

Discord webhook URLs are **immutable** — there is no rotate button. Two
scenarios:

- **No leak suspected** (routine onboarding, migrating an existing webhook
  into Doppler): just copy the existing URL from Discord and paste into
  Doppler. Skip to [Copy existing URL](#4a-copy-existing-url).
- **Leak suspected or rotation required**: delete the webhook and create
  a new one. Jump to [Rotate by delete + recreate](#4b-rotate-by-delete--recreate).

### 4a. Copy existing URL

1. Open Discord → your server → the ops channel.
2. Hover the channel name in the left sidebar and click the **gear icon**
   ("Edit Channel").
3. In the channel settings sidebar, click **Integrations** → **Webhooks**.
4. Click the existing webhook (e.g. `celstate-ops`).
5. Scroll to the bottom of the webhook detail panel and click **Copy
   Webhook URL**.
6. **Doppler:** add/edit `OPS_ALERT_WEBHOOK_URL` with the URL.

### 4b. Rotate by delete + recreate

1. Open Discord (desktop app or browser).
2. Navigate to your server, then to the ops channel that receives the
   alerts.
3. Hover over the channel name in the left sidebar and click the **gear
   icon** ("Edit Channel").
4. In the channel settings sidebar, click **Integrations**.
5. Click **Webhooks** (or the **View Webhooks** button if the section is
   collapsed).
6. Click the existing **celstate-ops** webhook (or whatever name you used
   originally). Note its avatar / display name so you can recreate it
   identically.
7. Scroll to the bottom of the webhook detail panel and click **Delete
   Webhook**, then confirm. The leaked URL is now dead.
8. Back on the **Webhooks** list, click **New Webhook**.
9. Set:
    - **Name:** the same name you noted in step 6.
    - **Channel:** the ops channel (auto-selected if you started from
      that channel's settings).
    - **Avatar:** *(optional — match the old one for visual continuity)*.
10. Click **Copy Webhook URL**.
11. **Doppler:** add/edit `OPS_ALERT_WEBHOOK_URL` with the new URL.

> **Note.** Discord webhook URLs contain the webhook ID and a long random
> token. The URL itself *is* the secret — anyone who has the URL can post
> as that webhook. Treat it like an API key.

---

## Final sync (run after all four are in Doppler)

From the repo root in a fresh PowerShell window:

```pwsh
pnpm secrets:sync:convex -- --prune
```

This:

- Pushes the four newly-rotated values from Doppler `prd` into Convex
  prod (replacing the leaked ones).
- Removes any Convex-prod variables that no longer exist in Doppler — for
  the 2026-04 incident this means deleting the legacy `SERVICE_KEY` row
  that had no codebase references.

Verify with the safe diff tool (names only, never values):

```pwsh
pnpm secrets:diff
```

Both numbers should match (e.g. "Convex prod: 19 secrets, Doppler prd: 20
secrets" — the extra in Doppler is `PUBLIC_*` which is intentionally
filtered out of Convex). The "In Convex only" and "In Doppler only" lists
should both be zero, except for `PUBLIC_*` names appearing only in
Doppler (those go to Vercel, not Convex).

## Verify the rotation worked

```pwsh
# Auth session probe (JSON). Unauthenticated callers still get 200 with `authenticated: false`.
Invoke-WebRequest -Uri "https://www.celstate.com/api/auth/session" `
  -SkipHttpErrorCheck | ForEach-Object { "Status: $($_.StatusCode); Body: $($_.Content)" }

# Homepage loads.
Invoke-WebRequest -Uri "https://www.celstate.com/" `
  -SkipHttpErrorCheck | ForEach-Object { "Status: $($_.StatusCode); Length: $($_.RawContentLength)" }
```

Then sign in to <https://www.celstate.com/auth> with Google (via **WorkOS AuthKit**). If sign-in
succeeds, the rotated vendor secrets propagated correctly (Stripe webhooks, Google client secret in Doppler, etc.).

If sign-in fails with `redirect_uri_mismatch` or `invalid_client`, the
Google OAuth secret didn't propagate — re-check that `AUTH_GOOGLE_SECRET`
in Doppler matches what you just enabled, and re-run the sync.

If a Stripe checkout fails with `signature verification`, the webhook
secret didn't propagate — same drill for `STRIPE_WEBHOOK_SECRET`.

---

## What "done" looks like

- All four `*_SECRET` / `*_URL` rows in Doppler `prd` show recent
  modification timestamps.
- `pnpm secrets:diff` shows zero drift between Convex prod and Doppler
  `prd` (excluding `PUBLIC_*`).
- A fresh sign-in succeeds.
- The auth canary GitHub Actions workflow's next scheduled run reports
  green (or run it manually from the Actions tab).
- The Google OAuth old secret has been **disabled and deleted** from the
  Google Auth Platform clients page.
