# Full-Path Auth Automation

> Status (2026-04-24): planned, not yet implemented.
>
> This document stays in `docs/implementation` because the repo currently proves auth health with a smoke check and protected-route reachability, but it does not yet drive the real Google OAuth redirect/callback path end-to-end in automation.

## 1. Goal

Add a production-grade automation layer that proves Celstate's real Google sign-in path works from `/auth` through provider redirect, Better Auth callback, session establishment, protected-route entry, and sign-out.

This should extend the existing verification system, not replace it.

## 2. Current Baseline

The current auth verification surface is already strong, but intentionally split:

- `scripts/check-auth-health.mjs` verifies `/auth` renders and `/api/auth/get-session` returns a healthy final status.
- `scripts/production-verification.ts` proves protected-route reachability with a pre-generated Playwright storage state.
- `src/routes/api/auth/[...all]/+server.ts` proxies Better Auth traffic through the SvelteKit surface to the Convex site URL.
- `src/convex/auth.ts` pins Better Auth to an explicit canonical `baseURL`, explicit `trustedOrigins`, and the configured Google provider.

Current docs already describe the remaining gap:

- `docs/product/authentication.md` says the smoke workflow does not cover full OAuth redirect/callback automation.
- `docs/runbooks/CI-AND-CANARIES.md` describes deploy verification as protected-route proof, not provider-path proof.
- `docs/product/production-confidence.md` treats AUTH as a deploy-critical domain, but the current protected-route proof still starts from stored session state.

That means the repo currently proves:

- the auth page is up,
- the Better Auth session endpoint is up,
- an existing authenticated session can reach `/app`.

It does **not** yet prove:

- the live Google OAuth handoff starts correctly,
- the callback returns through the same canonical origin,
- Better Auth completes the code exchange and writes session cookies,
- the first post-login protected render survives hydration and does not bounce back to `/auth`.

## 3. Best-Practice Summary (2026)

The current best practice is a layered auth-testing model:

1. Keep provider-free CI fast.
2. Run a tiny real-provider browser suite outside the PR gate.
3. Generate fresh authenticated browser state inside the run.
4. Reuse that state only within the same run for a few high-value assertions.
5. Use dedicated canary identities, not developer accounts.
6. Keep the real-provider suite serial and small.
7. Treat exact origin and redirect-URI correctness as part of the auth contract.

This aligns with current upstream guidance:

- Playwright recommends a setup-project pattern that creates `storageState` and reuses it across dependent tests inside the run.
- Better Auth recommends explicit `baseURL` and explicit `trustedOrigins` for security and stability.
- Google requires exact redirect URI matching and recommends separate testing and production OAuth projects overall.

For Celstate, that translates to:

- keep `pnpm verify` provider-free and local-preview-based,
- add a dedicated hosted Playwright auth suite for real Google login,
- run that suite manually and on schedule first,
- then fold it into deploy verification,
- continue using the **production** OAuth client for production verification so the check proves the real live configuration.

## 4. Scope

### In scope

- Real Google OAuth browser automation against the hosted app.
- Callback validation through the existing Better Auth proxy surface.
- Fresh storage-state generation during the workflow run.
- Reuse of that generated state for protected-route and sign-out assertions.
- Integration with the existing production verification workflow.
- Normalization of the current storage-state handoff contract.

### Out of scope

- Replacing the existing auth smoke canary.
- Adding Apple automation while Apple remains disabled.
- Expanding PR-gate E2E to hit the real provider.
- Re-architecting Better Auth or Convex auth internals.
- Broad auth UX redesign.

## 5. Design Principles

### 5.1 Extend the current system

The repo already has the right verification backbone in `scripts/production-verification.ts` and `.github/workflows/production-verification.yml`. The new work should slot into that system rather than create a second release gate.

### 5.2 Prove the real production path

The live deploy check must exercise the same production Google client, same canonical host, same SvelteKit auth proxy, and same Better Auth server config that customers use.

### 5.3 Keep the real-provider suite tiny

This suite should prove the path, not become a large regression suite. One real login plus a few dependent assertions is enough.

### 5.4 Fresh state beats long-lived state

A freshly generated storage state created during the run is the target. The existing secret-based stored session should remain only as a temporary fallback during rollout.

### 5.5 Stable infrastructure over clever retries

If Google treats hosted CI traffic as suspicious, solve that with a more stable runner or controlled canary account setup, not by piling on fragile retry logic.

## 6. Target Architecture

### 6.1 Final shape

The intended end state is:

1. A hosted Playwright setup project opens `/auth` on the canonical production origin.
2. It clicks Google sign-in and completes the real provider flow.
3. It waits until Celstate lands back on an authenticated protected route.
4. It writes storage state to the Playwright output directory.
5. Dependent hosted auth specs reuse that state for a small set of assertions.
6. The production verification runner consumes the generated storage-state file path.
7. The deploy gate DENYs if the real OAuth setup project fails or if dependent assertions fail.

### 6.2 Why a separate hosted Playwright config

The existing `playwright.config.ts` is intentionally preview-local:

- it always uses `http://127.0.0.1:4174`,
- it starts `vite preview`,
- it is designed for `pnpm verify`.

The hosted auth flow should not overload that config. The smallest correct shape is a second Playwright config dedicated to hosted verification, for example:

- `playwright.auth-hosted.config.ts`

This preserves the current local E2E contract while giving the auth flow its own base URL, retries, serialism, and artifact handling.

## 7. Proposed File Additions And Changes

### 7.1 New files

- `playwright.auth-hosted.config.ts`
- `e2e/auth/google-oauth.setup.ts`
- `e2e/auth/protected-route-after-oauth.spec.ts`
- `e2e/auth/sign-out-after-oauth.spec.ts`

### 7.2 Existing files to update

- `package.json`
- `.github/workflows/production-verification.yml`
- `scripts/production-verification.ts`
- `docs/product/authentication.md`
- `docs/runbooks/CI-AND-CANARIES.md`
- `docs/product/production-confidence.md`

### 7.3 Optional transitional helper

If the workflow logic becomes noisy, add a small script to write storage state from a fallback secret to a temporary file. This is optional; the current inline workflow step is acceptable during migration.

## 8. Hosted Playwright Design

### 8.1 Config shape

`playwright.auth-hosted.config.ts` should:

- set `testDir` to `e2e/auth`,
- use `baseURL` from a required env such as `AUTH_CANARY_BASE_URL`,
- avoid `webServer`,
- run Chromium only,
- keep `workers: 1`,
- keep trace and screenshot artifacts on failure,
- define a setup project and dependent projects.

Recommended project layout:

- `setup-google-oauth`
- `auth-dependent`

The setup project should write its storage state under the project output dir so each run starts clean.

### 8.2 Setup spec responsibilities

`e2e/auth/google-oauth.setup.ts` should:

1. start from a clean browser context,
2. visit `/auth`,
3. assert the auth page marker exists,
4. click the Google provider button,
5. complete the real Google login flow,
6. wait for the final URL to settle on `/app` or another protected route,
7. assert that the browser did not bounce back to `/auth`,
8. save storage state.

Important details:

- Wait for the final URL after redirects before writing storage state.
- Assert using stable route/state markers rather than marketing copy.
- If the app user row is still bootstrapping, do not fail unless auth itself is broken.

### 8.3 Dependent spec responsibilities

`e2e/auth/protected-route-after-oauth.spec.ts` should prove that a new context using the saved state can:

- open `/app`,
- survive reload or revisit,
- remain authenticated.

`e2e/auth/sign-out-after-oauth.spec.ts` should prove that:

- sign-out succeeds,
- the app returns to a public/auth surface,
- a new visit to `/app` redirects to `/auth?redirectTo=...`.

These tests should stay small. They are path proofs, not full feature coverage.

## 9. Google OAuth Setup

### 9.1 Production verification must use the production client

For the live deploy gate, the hosted suite must test the real production configuration. That means the production site should continue using the production `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` already consumed by `src/convex/auth.ts`.

This is important: a deploy gate that uses a different Google client is not proving the real customer path.

### 9.2 Separate testing and production projects still apply

Google's guidance to separate testing and production projects still matters overall. The recommended split is:

- non-production hosted environments use a testing Google project/client,
- production uses the production Google project/client,
- production verification uses the production client with dedicated canary accounts.

That gives Celstate both:

- safe dress rehearsal on non-prod,
- real-path proof on prod.

### 9.3 Callback and origin rules

The Google configuration must exactly match the live Better Auth surface:

- authorized redirect URI must exactly match the Better Auth callback URI,
- authorized origin must exactly match the canonical site origin,
- scheme, host, port, case, and trailing slash must be correct.

Because Celstate already treats canonical origin as a strict contract, do not rely on apex-to-`www` redirects inside provider configuration. Register the actual canonical host that the app serves from.

### 9.4 Canary identity

Use dedicated Google canary accounts only. Do not use personal developer accounts.

Recommended shape:

- one dedicated canary account for production auth verification,
- optional separate canary accounts for staging/manual rehearsal,
- no human mailbox reuse,
- stable account profile with minimal extra prompts.

If Google risk checks make hosted CI unstable, prefer moving only this workflow to a stable runner before adding retry complexity.

## 10. Storage-State Contract Normalization

Today there is a transitional contract split:

- workflow secret: `AUTH_CANARY_STORAGE_JSON`
- runner env file path: `AUTH_CANARY_PROTECTED_STORAGE_STATE`

The new implementation should make the file-path contract the only runtime contract for the runner.

### 10.1 Target contract

`scripts/production-verification.ts` should continue consuming:

- `AUTH_CANARY_PROTECTED_STORAGE_STATE`

But that path should come from a freshly generated Playwright artifact created earlier in the workflow.

### 10.2 Transitional fallback

Keep `AUTH_CANARY_STORAGE_JSON` only during rollout as a fallback if the real OAuth setup project is disabled or red. Remove it after the fresh-state path is stable.

## 11. Workflow Plan

### Phase 1 — add a dedicated hosted auth workflow

Create a workflow dedicated to real Google auth verification, for example:

- `.github/workflows/auth-oauth-verification.yml`

Initial triggers:

- `workflow_dispatch`
- nightly `schedule`

This workflow should:

1. install dependencies,
2. install Playwright Chromium,
3. run `pnpm exec playwright test -c playwright.auth-hosted.config.ts`,
4. upload traces/screenshots on failure.

This phase is for stabilization only. It should not gate deploys yet.

### Phase 2 — feed fresh state into deploy verification

After the setup spec is stable:

1. run the hosted auth setup project at the start of `production-verification.yml`,
2. capture the generated storage-state path,
3. export that path as `AUTH_CANARY_PROTECTED_STORAGE_STATE`,
4. run `pnpm verify:production` using the fresh file.

At this point, AUTH evidence becomes:

- smoke proof,
- fresh real-provider login proof,
- protected-route proof using freshly created state.

### Phase 3 — make full-path auth required for deploys

Once the hosted auth setup project is stable on deploys:

- require it for `POST_DEPLOY`,
- keep it required for `SCHEDULED`,
- retain the light smoke canary as a faster independent outage signal.

### Phase 4 — retire the static auth-state secret

When the fresh-state path is trusted:

- remove the workflow step that writes `AUTH_CANARY_STORAGE_JSON` to `/tmp`,
- remove the secret from repo settings,
- update docs to describe the fresh-state flow as canonical.

## 12. Package Script Plan

Add explicit scripts so the flow is easy to run locally or from CI:

- `test:e2e:auth-hosted`
- `test:e2e:auth-hosted:headed`

Example intent:

- `test:e2e:auth-hosted` runs the hosted Playwright config headless.
- `test:e2e:auth-hosted:headed` helps debug the provider flow manually.

These scripts should remain separate from `pnpm verify`.

## 13. Acceptance Criteria

The implementation is complete when all of the following are true:

1. A hosted Playwright setup project can complete real Google sign-in against the live app and save storage state.
2. The setup project fails clearly on canonical-origin drift, redirect mismatch, callback failure, or session-cookie failure.
3. A dependent spec can open `/app` with the saved state in a fresh context.
4. A dependent spec can sign out and confirm `/app` redirects back to auth.
5. `production-verification.yml` can consume the freshly generated storage-state file path.
6. The deploy gate no longer depends on a manually maintained auth-state secret for normal operation.
7. Product and runbook docs describe the new flow accurately.

## 14. Failure Modes To Design For

### 14.1 Redirect mismatch

Symptoms:

- Google rejects the request,
- callback never returns to Celstate,
- setup spec stalls on provider return.

Mitigation:

- exact callback registration,
- explicit assertion on final host and path,
- traces retained on failure.

### 14.2 Canonical-host drift

Symptoms:

- login begins on one host and returns to another,
- cookies are written but protected-route entry fails,
- callback loops or ends at `/auth`.

Mitigation:

- keep `SITE_URL` and `PUBLIC_SITE_URL` aligned,
- assert final URL is on the canonical origin,
- fail the setup spec immediately on mismatch.

### 14.3 Hydration churn after login

Symptoms:

- callback succeeds,
- first protected render briefly appears,
- app bounces back to `/auth`.

Mitigation:

- make the dependent assertion wait for a stable protected route,
- assert on final URL after post-login churn settles,
- avoid coupling the assertion to user-row bootstrap timing.

### 14.4 Google anti-abuse friction

Symptoms:

- intermittent extra prompts,
- login blocks only on CI,
- unstable provider UI steps.

Mitigation:

- dedicated canary account,
- stable runner if needed,
- keep the suite tiny and serial,
- avoid running it on every PR.

## 15. Rollout Order

1. Add hosted Playwright config and setup spec.
2. Stabilize it under manual dispatch.
3. Add nightly execution.
4. Add dependent specs for protected-route revisit and sign-out.
5. Integrate fresh storage-state generation into `production-verification.yml`.
6. Make it deploy-required.
7. Remove the fallback static storage-state secret.

## 16. Documentation Follow-Up

When implementation lands, update:

- `docs/product/authentication.md`
- `docs/runbooks/CI-AND-CANARIES.md`
- `docs/product/production-confidence.md`

The docs should clearly distinguish three layers:

- lightweight auth smoke,
- full-path real-provider auth proof,
- broader production verification across auth, generation, checkout, and settlement.

## 17. Open Decisions

These should be resolved during implementation, not before writing code:

1. Whether the hosted auth suite starts as a separate workflow or as a separate job inside `production-verification.yml`.
2. Whether a stable self-hosted runner is needed for Google reliability, or GitHub-hosted runners are sufficient.
3. Which protected route and which signed-in UI markers are the most stable post-login assertions for the first version.

## 18. Recommended Final Outcome

The final system should look like this:

- `pnpm verify` remains fast, local, and provider-free.
- `auth-canary.yml` remains the fast production smoke.
- hosted Playwright auth automation proves the real Google redirect/callback flow.
- `production-verification.yml` consumes freshly generated auth state and keeps AUTH as a first-class deploy gate.

That gives Celstate the highest-leverage auth quality improvement without broad auth refactors or duplicate infrastructure.
