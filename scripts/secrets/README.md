# Secret management & rotation

Doppler is the **single source of truth** for celstate secrets. Everything else
(Convex deployments, Vercel projects, GitHub Actions secrets) is a downstream
read replica synced from Doppler via the scripts in this directory.

Never read secrets back via `convex env list` or any other CLI that prints
plaintext to a terminal — that output gets captured by AI assistants, shell
history, and screen sharing tools, which is how the original 2026-04 leak
happened. Always treat the Doppler dashboard or the `--only-names` outputs as
the only safe ways to inspect.

## Overview of scripts

| Script | Purpose |
|---|---|
| `rotate.mjs` | Generate fresh values for auto-rotatable secrets (JWT keypair, Verification Runner secret, QA reset secret) and upload to Doppler. |
| `gcp-rotate-sa-key.mjs` | Rotate a GCP service account key: create new key via `gcloud`, upload JSON to Doppler, delete old key. |
| `sync.mjs` | Pull from Doppler and push to a target system: Convex (`prod`/`dev`), Vercel (`production`/`preview`/`development`), or GitHub Actions secrets in the current repo. The `pnpm` shortcuts pin both `--project=celstate` and `--config=<dev\|prd>` so they are insensitive to your local `doppler setup`. |
| `bootstrap-dev.mjs` | One-shot migration tool: read legacy `.env` / `.env.local` from disk silently, copy a curated subset of values from Doppler `prd`, rename legacy names to canonical names, and upload to Doppler `dev`. Run only when bootstrapping or rebuilding Doppler dev from a repo that still has legacy env files. After it succeeds, archive the `.env*` files and follow `pnpm secrets:rotate:dev` + `pnpm secrets:sync:convex:dev`. |
| `diff-convex-vs-doppler.mjs` | Compare *names* (never values) between Convex prod and Doppler `prd`. Use this to audit drift without leaking. |
| `lib/doppler.mjs` | Shared helpers: locate the doppler binary cross-platform, run commands without leaking values to stdout. |

## Common operations

Use the `pnpm secrets:*` shortcuts (defined in `package.json`) rather than
invoking `node scripts/secrets/...` directly — the shortcuts are the
canonical names referenced from runbooks and the quarterly Discord
rotation reminder.

### Routine rotation (every 90 days)

A Convex cron posts a reminder to the Discord ops channel on the 1st of
Jan/Apr/Jul/Oct at 14:00 UTC (see `docs/runbooks/SECRETS-MANAGEMENT.md`,
`Reminders`). When that fires, run:

```pwsh
# 1. Auto-rotate the four programmatic secrets in Doppler prd.
pnpm secrets:rotate

# 2. Mirror into Doppler dev so local sign-in keeps working post-rotation.
pnpm secrets:rotate:dev

# 3. Rotate the GCP service account key (use the latest oldKeyId from gcloud).
gcloud iam service-accounts keys list `
  --iam-account=vertex-express@celstate-489304.iam.gserviceaccount.com `
  --project=celstate-489304
doppler setup --project celstate --config prd  # rotate-gcp uses the linked config
pnpm secrets:rotate-gcp -- `
  --service-account=vertex-express@celstate-489304.iam.gserviceaccount.com `
  --project=celstate-489304 `
  --old-key-id=<KEY_ID_FROM_LIST>

# 4. Sync Doppler prd -> Convex prod (atomic --from-file batch).
pnpm secrets:sync:convex

# 5. Sync Doppler dev -> Convex dev (so local sign-in keeps working).
pnpm secrets:sync:convex:dev

# 6. Sync the canary secret to GitHub Actions.
pnpm secrets:sync:gh

# 7. (Optional) Sync PUBLIC_* to Vercel if any browser-visible value changed.
#    Production AND preview both consume the prd PUBLIC_* values.
pnpm secrets:sync:vercel
pnpm secrets:sync:vercel:preview
```

### Emergency rotation (suspected leak)

Same as above, but rotate **everything** in the same window. Manual dashboard
rotations required for Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`),
Google OAuth (`AUTH_GOOGLE_SECRET`), and Discord (`OPS_ALERT_WEBHOOK_URL`) —
these systems do not expose CLI rotation APIs as of 2026-Q2. Click-paths
for the current 2026 vendor UIs:
[`docs/runbooks/MANUAL-SECRET-ROTATION-GUIDE.md`](../../docs/runbooks/MANUAL-SECRET-ROTATION-GUIDE.md).

After updating Doppler with the new manual values, run the sync.

### Adding a new secret

Decide first whether the secret is needed in dev, prod, or both. Most are
both, but with **different values** per config (Stripe test vs live, JWT
keypairs, Vertex SA, `SITE_URL`, etc.).

```pwsh
# Add to prd (production / Vercel preview / GitHub Actions consumers):
doppler setup --project celstate --config prd
doppler secrets set NEW_SECRET_NAME=<prod-value>
pnpm secrets:sync:convex

# Add to dev (local development / Convex dev consumers):
doppler setup --project celstate --config dev
doppler secrets set NEW_SECRET_NAME=<dev-value>
pnpm secrets:sync:convex:dev
```

If the new secret is `PUBLIC_*` (browser-visible), it is filtered out of
the Convex sync and instead flows to Vercel via
`pnpm secrets:sync:vercel` and `pnpm secrets:sync:vercel:preview` (both
targets must carry every `PUBLIC_*` name — see
`docs/runbooks/PUBLIC-ENV-CHECKLIST.md`). If it is anything else, it stays
out of Vercel.

### Auditing drift

```pwsh
# Show names only — never any values.
pnpm secrets:diff
```

To remove orphaned env vars from Convex that are no longer in Doppler, run
`pnpm secrets:sync:convex -- --prune`. **Use with care** — verify the diff
output looks right before pruning.

## Prerequisites

- **Doppler CLI** (`doppler` on PATH, or set `DOPPLER_BIN=<path>`).
  Authed with `doppler login` and linked via `doppler setup --project celstate
  --config prd`.
- **gcloud CLI** authed as a principal with `iam.serviceAccountKeyAdmin` on
  `vertex-express@celstate-489304.iam.gserviceaccount.com`.
- **GitHub CLI** (`gh`) authed with `workflow` scope on this repo.
- **Convex CLI** (`pnpm exec convex`) authed for the celstate project.
- **Vercel CLI** (`vercel`) authed and linked to the celstate Vercel project.

## Threat model and design choices

- **No plaintext on disk longer than necessary.** All temp files use OS temp
  dir, mode `0o600` (best-effort on Windows), and are deleted in a `finally`
  block.
- **No plaintext printed to stdout.** All scripts capture and discard stdout
  from CLIs that would otherwise echo values (e.g. `doppler secrets set` with
  `--silent`, `convex env set` via `--from-file`).
- **Atomic writes where possible.** Convex sync uses `env set --from-file
  --force`, which either applies all changes or none.
- **Fail-closed on rotation.** GCP key rotation refuses to delete the old key
  if Doppler upload of the new key fails. JWT rotation invalidates all
  sessions on success — by design.
- **No secret values flow through this repository.** The scripts contain logic
  only; values exist only in Doppler, Convex, Vercel, and GitHub Actions
  secret stores at rest.
