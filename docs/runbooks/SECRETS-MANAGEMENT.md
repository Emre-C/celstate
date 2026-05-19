# Secrets management

**Source of truth:** [Doppler](https://dashboard.doppler.com) (project `celstate`,
configs `dev` / `stg` / `prd`). Every other system — Convex deployments,
Vercel projects, GitHub Actions secrets — is a downstream read replica synced
from Doppler via the scripts in [`scripts/secrets/`](../../scripts/secrets/).

> **Why Doppler-first:** in 2026-04 the Convex CLI's `env list` output (which
> still prints plaintext values) was captured by an AI assistant cloud log,
> exposing every production secret. The mitigation is a vault that the CLI
> never reads back out of, plus scripts that sync **from** the vault **into**
> downstream systems and never the reverse.

## TL;DR for new contributors

1. Install Doppler CLI: <https://docs.doppler.com/docs/install-cli>.
2. `doppler login` → `doppler setup --project celstate --config dev` for local
   work, or `--config prd` for production maintenance.
3. Use `doppler run -- pnpm dev` instead of `.env` files.
4. Never run `convex env list` (any flag) — it leaks values into terminal
   history and any LLM context capturing the session. Use
   `pnpm secrets:diff` to inspect names only.
5. **The `pnpm secrets:*` shortcuts pin both Doppler `--project=celstate` and
   `--config=<dev|prd>` explicitly**, so they ignore your `doppler setup`
   state. There is no way to accidentally push `prd` values to Convex `dev`
   (or vice versa) by being linked to the wrong config — use the
   `:dev`-suffixed shortcuts for dev targets and the bare ones for prod.
   Local dev guidance lives in [Local development](#local-development);
   Vercel-specific notes in [Vercel: Preview vs Production](#vercel-preview-vs-production).

## Topology

```
   ┌──────────────────┐                    ┌──────────────────┐
   │  Doppler (dev)   │                    │  Doppler (prd)   │  ← prod source of truth
   └────────┬─────────┘                    └────────┬─────────┘
            │ pnpm secrets:*:dev                    │ pnpm secrets:*
            ▼                                       ▼
     ┌──────────────┐               ┌──────────────────────────────┐
     │  Convex dev  │               │  Convex prod   Vercel prod   │
     │  (devs only) │               │  (15 backend)  Vercel preview│
     └──────────────┘               │  (5 PUBLIC_*)  GitHub Actions│
                                    └──────────────────────────────┘
     local dev: `doppler run -- pnpm dev` reads dev directly
```

- **Convex prod** receives all non-`PUBLIC_*` secrets (Stripe, Vertex, verification runner, `WORKOS_CLIENT_ID` for JWT validation, etc.) and reads them via `process.env.NAME`.
- **Convex dev** is the same shape but populated from Doppler `dev` and
  scoped to local development. Stripe is in test mode there.
- **Vercel prod and Vercel preview** receive every `PUBLIC_*` name **plus** an
  allowlisted set of **server** secrets required by `@workos/authkit-sveltekit`
  (`WORKOS_*`) and optional `SENTRY_DSN`. Both targets are synced from Doppler
  **`prd`** (preview deploys use prod Convex — see
  [Vercel: Preview vs Production](#vercel-preview-vs-production)). Other backend-only
  secrets stay on Convex only.
- **GitHub Actions** receives the canary's `VERIFICATION_RUNNER_SECRET` so the
  scheduled auth-canary workflow can probe the live site. CI also sets **placeholder**
  `WORKOS_*` values so `vite preview` can load `hooks.server.ts` during `pnpm verify`
  (see `.github/workflows/ci.yml`).
- **Local development** never receives a synced bundle — `doppler run` reads
  Doppler `dev` directly into the process environment for `pnpm dev`.

## Available scripts

All under [`scripts/secrets/`](../../scripts/secrets/) with `pnpm` shortcuts.

| Command | Purpose |
|---|---|
| `pnpm secrets:diff` | Compare *names* (never values) between Convex prod and Doppler `prd`. Use to audit drift safely. |
| `pnpm secrets:rotate [groups…]` | Generate fresh values for auto-rotatable secrets (`jwt`, `verification-runner-secret`, `qa-user-reset-secret`, …) and upload to Doppler **`prd`**. With no args, rotates all groups. |
| `pnpm secrets:rotate:dev [groups…]` | Same, but uploads to Doppler **`dev`**. |
| `pnpm secrets:rotate-gcp -- --service-account=… --project=… --old-key-id=…` | Rotate a GCP service-account key end-to-end: create new via `gcloud`, validate JSON, upload to Doppler, delete old. Reads the active `doppler setup`; run after `doppler setup --config prd` for prod rotations. |
| `pnpm secrets:sync:convex` | Push all non-`PUBLIC_*` secrets from Doppler **`prd`** to Convex prod via `convex env set --from-file --force` (atomic). Convex env **prune** is not supported (listing env prints secret values — see AGENTS.md). |
| `pnpm secrets:sync:convex:dev` | Same, from Doppler **`dev`** to Convex dev. |
| `pnpm secrets:sync:vercel` | Push `PUBLIC_*` **and** the WorkOS/Sentry server allowlist from Doppler **`prd`** to Vercel **production**. |
| `pnpm secrets:sync:vercel:preview` | Same for Vercel **preview**. |
| `pnpm secrets:sync:gh` | Push `VERIFICATION_RUNNER_SECRET` from Doppler **`prd`** to GitHub Actions secrets in this repo. |

All shortcuts pin `--project=celstate` and `--config=<dev|prd>` so they
behave the same regardless of your local `doppler setup` state. To target a
non-default project or config (rare — e.g. a sandbox), invoke the script
directly: `node scripts/secrets/sync.mjs --target=convex --env=dev --project=… --config=…`.

The shared library at [`scripts/secrets/lib/doppler.mjs`](../../scripts/secrets/lib/doppler.mjs)
locates the Doppler binary cross-platform (handles winget paths on Windows)
and runs commands without echoing values to stdout.

## Reminders

A Convex cron (`@/src/convex/crons.ts`, `secret rotation reminder`) posts a
quarterly reminder to the Discord ops channel via `OPS_ALERT_WEBHOOK_URL`
on the **1st of January, April, July, and October at 14:00 UTC** (~91 days
between runs). The message lists the exact `pnpm secrets:*` commands to
run plus the manual vendor-dashboard rotations. Implementation lives in
`@/src/convex/ops.ts` (`sendSecretRotationReminder`) and the message
formatting in `@/src/convex/lib/ops.ts`
(`buildSecretRotationReminderRequest`).

To trigger a reminder manually for testing, run from the repo root:

```pwsh
pnpm exec convex run --prod ops:sendSecretRotationReminder '{}'
```

If `OPS_ALERT_WEBHOOK_URL` is unset on the Convex deployment, the action
logs a warning and exits without posting.

## Routine rotation (every 90 days)

```pwsh
# 1. Auto-rotate the four programmatically-generated secrets in Doppler prd.
pnpm secrets:rotate

# 2. Mirror the rotation into Doppler dev so local development keeps working.
#    (Different values from prd — rotated independently.)
pnpm secrets:rotate:dev

# 3. Rotate the GCP service-account key (replace --old-key-id with the
#    current USER_MANAGED key id from `gcloud iam service-accounts keys list`).
#    Make sure you are linked to the prd config first.
doppler setup --project celstate --config prd
pnpm secrets:rotate-gcp -- `
  --service-account=vertex-express@celstate-489304.iam.gserviceaccount.com `
  --project=celstate-489304 `
  --old-key-id=<CURRENT_KEY_ID>

# 4. Push prod secrets from Doppler -> Convex prod.
pnpm secrets:sync:convex

# 5. Push dev secrets from Doppler -> Convex dev (so local sign-in works).
pnpm secrets:sync:convex:dev

# 6. Push the canary secret to GitHub Actions.
pnpm secrets:sync:gh

# 7. (Optional) Sync PUBLIC_* to Vercel only if any of them changed.
#    Production AND preview both consume the prd PUBLIC_* values.
pnpm secrets:sync:vercel
pnpm secrets:sync:vercel:preview
```

JWT, WorkOS cookie password, and other auth-related rotations invalidate active sessions. Plan for a
brief window where users are signed out. The dev rotation only affects local
machines and CI dev probes; it does not interrupt prod users.

## Local development

Local dev never reads a synced `.env` file. The pattern is:

```pwsh
# One-time: link this clone to Doppler dev.
doppler login
doppler setup --project celstate --config dev

# Day-to-day: run dev with secrets injected at process start.
doppler run -- pnpm dev
```

`doppler run` materializes Doppler `dev` into `process.env` for the lifetime
of the child process. Vite + `pnpm exec convex dev` (started via the `dev`
script) both inherit it. No plaintext touches disk.

**When to sync to Convex dev** (`pnpm secrets:sync:convex:dev`):

- After `pnpm secrets:rotate:dev` — pushes the new JWT/Better-Auth/etc.
  values into the Convex **dev** deployment so server-side functions agree
  with the SvelteKit-side `doppler run` view.
- After adding a brand-new backend secret name to Doppler `dev` (e.g. a
  third-party API key for a feature you're building locally).
- After running `pnpm secrets:diff` and seeing the dev deployment lag the
  Doppler dev config. (`secrets:diff` itself only inspects prod; for dev,
  read the Doppler dev config in the dashboard — never via
  `convex env list`.)

**Adding a dev-only secret:** add it to Doppler `dev` (dashboard or
`doppler secrets set NAME=value` while linked to dev), then
`pnpm secrets:sync:convex:dev`. If the same name is also needed in prod,
add it separately to Doppler `prd` and run `pnpm secrets:sync:convex`.
Do **not** copy-paste values between configs — Stripe (`sk_test_*` vs
`sk_live_*`), Vertex SA, JWT, and `SITE_URL` deliberately differ.

**Local `.env.example` vs Doppler:** the committed
[`.env.example`](../../.env.example) only documents `PUBLIC_*` names that
the SvelteKit build inlines. It is **not** authoritative — Doppler `dev` is.
For a fresh clone, `doppler run -- pnpm dev` is enough; you do not need to
create a `.env.local` unless you are working without Doppler access.

## Vercel: Preview vs Production

Vercel maintains **separate environment variable sets** for the Preview and
Production targets. Both must contain every `PUBLIC_*` name the build
imports — see [`PUBLIC-ENV-CHECKLIST.md`](./PUBLIC-ENV-CHECKLIST.md). If
Preview is missing a name, **Preview deploys fail to build** while Production
works, which is easy to miss until a PR preview link 404s.

The sync pattern is symmetric:

```pwsh
# Production target — used by celstate.com.
pnpm secrets:sync:vercel

# Preview target — used by every PR / non-production deploy.
pnpm secrets:sync:vercel:preview
```

Both pull from Doppler **`prd`** because Preview deployments point at the
production Convex deployment (`PUBLIC_CONVEX_URL` etc. are the prod values).
We deliberately do not sync Doppler `dev` to Vercel — there is no public
Vercel deployment that should talk to Convex dev.

### CLI gotcha: `vercel env add NAME preview` may refuse `main`

On solo-`main` repos, `vercel env add NAME preview` sometimes asks for a
non-production Git branch and refuses `main`. The script surfaces guidance
when this happens; the reliable workarounds are:

1. **Vercel dashboard:** Settings → Environment Variables → open the
   variable → enable **Preview** alongside Production → Save → redeploy.
2. **REST API:** `POST /v10/projects/{projectId}/env` with
   `target: ["preview"]` and a `VERCEL_TOKEN`. See
   [Vercel docs](https://vercel.com/docs/rest-api/reference/endpoints/projects/create-one-or-more-environment-variables).

After the manual fix, rerun `pnpm secrets:sync:vercel:preview` to confirm
the other names sync cleanly.

## Emergency rotation (suspected leak)

For systems without programmatic rotation (Stripe, Google OAuth, Discord),
follow [`MANUAL-SECRET-ROTATION-GUIDE.md`](./MANUAL-SECRET-ROTATION-GUIDE.md)
for current 2026 dashboard click-paths. After updating Doppler with the new
manual values, run `pnpm secrets:sync:convex` to propagate. If the leak
plausibly exposed dev values too (shared dev machine, leaked dev
`doppler run` session, etc.), also run `pnpm secrets:rotate:dev` followed
by `pnpm secrets:sync:convex:dev`.

Always rotate the broadest-blast-radius secrets first: live Stripe key,
service-account keys, JWT signing keys.

## Secret inventory

Names belong to one of three categories. **Never** put values in this doc.

### Auto-rotatable (script generates new value, uploads to Doppler)
| Name | Generator | What it signs / authorizes |
|---|---|---|
| `JWT_PRIVATE_KEY` + `JWKS` | `pnpm secrets:rotate jwt` | Legacy RSA keypair (older auth stacks). Safe to skip when Convex no longer references these names. |
| `WORKOS_COOKIE_PASSWORD` | `pnpm secrets:rotate workos-cookie-password` | AuthKit session cookie encryption (`@workos/authkit-sveltekit`). |
| `VERIFICATION_RUNNER_SECRET` | `pnpm secrets:rotate verification-runner-secret` | Bearer for the production canary HTTP routes. |
| `QA_USER_RESET_SECRET` | `pnpm secrets:rotate qa-user-reset-secret` | Bearer for the QA reset endpoint (dev/stg only). |

### Programmatic via service CLI (script orchestrates rotation)
| Name | Tooling | Notes |
|---|---|---|
| `VERTEX_AI_SERVICE_ACCOUNT_JSON` | `gcloud iam service-accounts keys create/delete` via `pnpm secrets:rotate-gcp` | New key → upload to Doppler → delete old. Old key dies in GCP immediately. |

### Manual via vendor dashboard (requires UI clicks)
| Name | Vendor | Why no CLI rotation |
|---|---|---|
| `STRIPE_SECRET_KEY` | [Stripe Dashboard → API keys](https://dashboard.stripe.com/apikeys) | No public API rotation endpoint for live secret keys. |
| `STRIPE_WEBHOOK_SECRET` | [Stripe Workbench → Webhooks](https://dashboard.stripe.com/webhooks) | Same. |
| `WORKOS_CLIENT_ID` | [WorkOS Dashboard](https://dashboard.workos.com/) | Must match AuthKit + Convex `auth.config.ts`. |
| `WORKOS_API_KEY` | WorkOS Dashboard | Secret key (`sk_…`). |
| `WORKOS_REDIRECT_URI` | Your hosting config | Exact callback URL registered in WorkOS. |
| `AUTH_GOOGLE_SECRET` | [Google Auth Platform clients](https://console.developers.google.com/auth/clients) | Google API does not expose client-secret rotation. |
| `OPS_ALERT_WEBHOOK_URL` | Discord channel settings | Discord webhook URLs are immutable; rotation = delete + recreate. |

### Migrated config (not really secret, but in Doppler for source-of-truth integrity)
| Name | Notes |
|---|---|
| `AUTH_GOOGLE_ID` | Public OAuth client ID. |
| `HOSTING_URL`, `SITE_URL` | Canonical site origins. |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_STARTER` | Public Stripe price IDs. |
| `POSTHOG_API_KEY`, `POSTHOG_HOST` | Public ingest key + region. |
| `OPS_ALERT_WEBHOOK_KIND` | `discord`/`slack` discriminator. |
| `VERTEX_AI_PROJECT_ID`, `VERTEX_AI_LOCATION` | GCP project + region for Gemini. |
| `PUBLIC_*` | Browser-visible config; synced to Vercel with the WorkOS/Sentry server allowlist (see `scripts/secrets/sync.mjs`). |

## Threat model and design choices

- **No plaintext on disk longer than necessary.** All temp files use OS temp
  dir, mode `0o600` (best-effort on Windows), and are deleted in a `finally`
  block.
- **No plaintext printed to stdout.** Scripts capture and discard stdout from
  CLIs that would otherwise echo values (`doppler secrets set --silent`,
  `convex env set --from-file`).
- **Atomic writes where possible.** Convex sync uses `env set --from-file
  --force`, which either applies all changes or none.
- **Fail-closed on rotation.** GCP key rotation refuses to delete the old key
  if Doppler upload of the new key fails. JWT rotation invalidates all
  sessions on success — by design.
- **Defense in depth.** Even with Doppler in place, do not run `convex env
  list` (the original leak vector). Treat any plaintext output of a CLI run
  in a context with AI assistants or screen sharing as compromised.

## Cost

Doppler **Free** tier covers our use (≤ 5 users, unlimited projects, audit
logs, secret rotation). No per-secret cost. Doppler Team is `$4/user/month`
if we ever need RBAC, IP allowlist, or `5+` users.

## Related runbooks

- [`CONVEX-VERCEL-ENVIRONMENTS.md`](./CONVEX-VERCEL-ENVIRONMENTS.md) — Convex
  vs Vercel responsibilities and why we keep secrets out of Vercel.
- [`STRIPE-CONVEX-ENVIRONMENTS.md`](./STRIPE-CONVEX-ENVIRONMENTS.md) — Stripe
  live vs test keys and per-deployment Stripe configuration.
- [`VERTEX-AI-CONVEX-SETUP.md`](./VERTEX-AI-CONVEX-SETUP.md) — Vertex AI
  service-account setup (initial onboarding, before automated rotation).
- [`PUBLIC-ENV-CHECKLIST.md`](./PUBLIC-ENV-CHECKLIST.md) — required
  `PUBLIC_*` names on Vercel.
- [`MANUAL-SECRET-ROTATION-GUIDE.md`](./MANUAL-SECRET-ROTATION-GUIDE.md) —
  click-paths for the four dashboard-only rotations.
