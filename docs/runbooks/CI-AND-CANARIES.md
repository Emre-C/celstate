# CI, auth canary, and production verification

Short reference for what runs on GitHub Actions, common failure modes, and how to avoid regressions.

**Scope:** `ci.yml` is **preview-local** (build + marketing E2E). `auth-canary.yml` is a **lightweight production smoke** on `/auth` and `/api/auth/session`. **`production-verification.yml`** runs **deploy-scoped** probes against live production (auth with protected-route proof, generation, checkout session, and scheduled live settlement). Contract and evidence model: [`docs/product/production-confidence.md`](../product/production-confidence.md).

## Local verification tiers

- **Fast gate** — `pnpm check`, `pnpm typecheck:tsc`, `pnpm lint:ts`, `pnpm test` (no production build, no Playwright).
- **Full repo gate** — `pnpm verify` (matches the heavy local/CI pipeline: Knip, jscpd, build, E2E).

Knip false positives, try/marker audit commands, and cleanup audit pointers: [`CODEBASE-HYGIENE.md`](./CODEBASE-HYGIENE.md).

## CI (`/.github/workflows/ci.yml`)

Two steps after checkout/install:

1. **`pnpm test:auth`** — Fast Vitest subset (guards, canary probe contract, Convex provisioning, access-token JSON contract, etc.). See `package.json` → `test:auth`.
2. **`pnpm verify`** — Typecheck, Knip, jscpd, ESLint, full Vitest, production `vite build`, then **`pnpm test:e2e`** (Playwright against `vite preview`).

Other notes:

- **pnpm:** Version comes only from `package.json` → `"packageManager": "pnpm@…"`. Do not also pin `version:` on `pnpm/action-setup` (the action errors if both disagree).
- **`tsx`:** Scripts such as `check:public-env` use `tsx` and it is a **devDependency**. Relying on `npx tsx` without installing `tsx` breaks CI.
- **Playwright:** The workflow runs `pnpm exec playwright install chromium --with-deps` so E2E can launch Chromium on the runner.
- **Public env in CI:** The workflow sets placeholder `PUBLIC_*` values so `pnpm verify` can build without real Convex/PostHog secrets. **`PUBLIC_SITE_URL` is `http://127.0.0.1:4174`** so the built canonical origin matches the preview URL used by Playwright (see [PUBLIC-ENV-CHECKLIST.md](./PUBLIC-ENV-CHECKLIST.md), rule **4. CI**).
- **E2E:** `playwright.config.ts` starts **`vite preview`** on port **4174**; `e2e/marketing-landing.spec.ts` loads `/` and fails if the console reports Svelte **`hydration_mismatch`** or if primary hero CTAs are missing.
- **Auth-boundary PRs** — CI does not validate live WorkOS JWT claim shape. Use the checklist in [`authentication.md`](../product/authentication.md) (real sign-in, token inspection, `pnpm check:kit-server-env`) before merging auth changes.

## Auth Canary (`/.github/workflows/auth-canary.yml`)

- **Schedule:** Every **15 minutes** (not every 5). Reduces alert noise while still catching sustained outages.
- **Secrets (repo → Settings → Actions → Secrets):**
  - `AUTH_CANARY_BASE_URL` — **HTTPS origin your customers use**, typically the **canonical** host (e.g. `www` if Vercel redirects apex → `www`).
  - `OPS_ALERT_WEBHOOK_URL` / `OPS_ALERT_WEBHOOK_KIND` — optional; used when the canary fails.

### Apex vs `www`

If the bare domain (`https://example.com`) **308-redirects** to `https://www.example.com`, the canary must either:

- Set `AUTH_CANARY_BASE_URL` to the **final** origin (`https://www.…`), or  
- Rely on the script’s default **fetch redirect following** for `/api/auth/session` (do not use `redirect: 'manual'` for that probe, or a 308 is reported as failure).

### Auth route resilience

`/api/auth/*` is served by **SvelteKit** (WorkOS AuthKit). Operational notes:

- Prefer **stable 200 / 401** final statuses for `/api/auth/session` JSON probes after redirects.
- Repeated **5xx** on auth paths should raise via `src/lib/server/auth-alerts.ts` (Sentry + ops webhook when configured).

### Contract tests

`scripts/auth-canary-probe.mjs` defines which **final** HTTP statuses count as OK for the `/api/auth/session` probe (`200`, `401`).  
`scripts/auth-canary-probe.test.ts` locks that in (including that `308` is not OK as a final status).

### Interpreting failures (`scripts/check-auth-health.mjs`)

- Failures are prefixed with **`[auth_page]`** (HTML `/auth` marker probe) or **`[get_session]`** (JSON `/api/auth/session` probe) so logs and ops webhooks name the failing step.
- Non-OK responses include safe diagnostics in the workflow log: final URL, selected response headers (`cf-ray`, `server`, `x-vercel-id`, `x-request-id`, `convex-usher`, `via`, `content-type`), and a small body prefix. Request cookies and `set-cookie` are never logged.
- **`request timed out after …ms`** means the probe’s `fetch` hit the per-request abort budget (cold starts, edge/network blips, or GitHub runner egress). A single timeout with surrounding runs **green** usually points to **transience**, not a bad HTTP status from the app.
- For sustained outages, expect explicit status / content-type / marker errors rather than only timeouts.
- GitHub scheduled workflows are best-effort and can be delayed or skipped during platform load. Treat this workflow as a production smoke check, not precise uptime monitoring or a recovery-time clock.

## Production verification (`/.github/workflows/production-verification.yml`)

Machine-evaluable **release evidence** for production: runner `scripts/production-verification.ts` exercises domains **AUTH**, **GENERATION**, **CHECKOUT_SESSION**, and (on the **weekly** schedule only) **LIVE_SETTLEMENT**, persists results to Convex (`verificationRuns`, `verificationEvidence`), and **exits non-zero** when the gate returns **DENY**.

- **When it runs**
  - **`deployment_status`** — After a **successful** GitHub deployment to the **Production** environment (e.g. Vercel production deploys). Other deployment states/environments are skipped by workflow `if`.
  - **`schedule`** — Weekly (Monday 06:00 UTC cron in the workflow); includes live-settlement when secrets support it.
  - **`workflow_dispatch` / `workflow_call`** — Manual or reusable invocations; optional inputs can pass `deployment_id`, `site_url`, `git_sha`.

- **Secrets (repo → Settings → Actions → Secrets and variables)**
  - **`VERIFICATION_RUNNER_SECRET`** — Shared secret for Convex HTTP verification routes.
  - **`CONVEX_URL`** — Production Convex deployment URL for the runner.
  - **`AUTH_CANARY_BASE_URL`** — Canonical HTTPS origin (same role as the auth canary; overridable per run via `site_url` input).
  - **`AUTH_CANARY_STORAGE_JSON`** — Playwright storage state JSON for an authenticated session (protected-route auth proof). Required for **POST_DEPLOY** / **SCHEDULED** unless you explicitly disable protected-route requirement (see runner env `AUTH_CANARY_REQUIRE_PROTECTED_ROUTE`).

- **Variables (optional)**
  - **`AUTH_CANARY_REQUIRE_PROTECTED_ROUTE`** — Repository variable; aligns with the runner’s default (protected-route proof expected for deploy/scheduled triggers).

- **External setup** — Vercel (or similar) **deployment protection** can gate promotion on this workflow’s check status; WorkOS canary users and one-time principal bootstrap are described in the [formal spec §10.3](../product/production-confidence.md#103-remaining-external-configuration).

## Optional hardening (not in repo by default)

- **actionlint:** Validate workflow YAML in CI (`rhysd/actionlint` or install locally). Catches some workflow mistakes early.
- **Manual smoke:** After changing auth routes or domains, run **Actions → Auth Canary → Run workflow** once.

## Related docs

- `docs/product/authentication.md` — Regression coverage, scheduled auth smoke, and production verification (auth domain)
- `docs/product/production-confidence.md` — Full contract, gates, and evidence map
- `docs/runbooks/PUBLIC-ENV-CHECKLIST.md` — CI `PUBLIC_SITE_URL` vs production
- `docs/runbooks/CODEBASE-HYGIENE.md` — Local gates, Knip caveats, audit artifacts
- `docs/product/observability.md` — Canary and verification file references
