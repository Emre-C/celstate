# CI and Auth Canary

Short reference for what runs on GitHub Actions, common failure modes, and how to avoid regressions.

## CI (`/.github/workflows/ci.yml`)

- **pnpm:** Version comes only from `package.json` → `"packageManager": "pnpm@…"`. Do not also pin `version:` on `pnpm/action-setup` (the action errors if both disagree).
- **`tsx`:** Scripts such as `check:public-env` use `tsx` and it is a **devDependency**. Relying on `npx tsx` without installing `tsx` breaks CI.
- **Public env in CI:** The workflow sets placeholder `PUBLIC_*` values so `pnpm verify` can build without real Convex/PostHog secrets. See `PUBLIC-ENV-CHECKLIST.md`.

## Auth Canary (`/.github/workflows/auth-canary.yml`)

- **Schedule:** Every **15 minutes** (not every 5). Reduces alert noise while still catching sustained outages.
- **Secrets (repo → Settings → Actions → Secrets):**
  - `AUTH_CANARY_BASE_URL` — **HTTPS origin your customers use**, typically the **canonical** host (e.g. `www` if Vercel redirects apex → `www`).
  - `OPS_ALERT_WEBHOOK_URL` / `OPS_ALERT_WEBHOOK_KIND` — optional; used when the canary fails.

### Apex vs `www`

If the bare domain (`https://example.com`) **308-redirects** to `https://www.example.com`, the canary must either:

- Set `AUTH_CANARY_BASE_URL` to the **final** origin (`https://www.…`), or  
- Rely on the script’s default **fetch redirect following** for `/api/auth/get-session` (do not use `redirect: 'manual'` for that probe, or a 308 is reported as failure).

### Contract tests

`scripts/auth-canary-probe.mjs` defines which **final** HTTP statuses count as OK for the get-session probe (`200`, `401`).  
`scripts/auth-canary-probe.test.ts` locks that in (including that `308` is not OK as a final status).

## Optional hardening (not in repo by default)

- **actionlint:** Validate workflow YAML in CI (`rhysd/actionlint` or install locally). Catches some workflow mistakes early.
- **Manual smoke:** After changing auth routes or domains, run **Actions → Auth Canary → Run workflow** once.

## Related docs

- `docs/product/authentication.md` — Scheduled auth canary section  
- `docs/product/observability.md` — Canary file references  
