# QA Reset

Operational runbook for resetting Celstate's dedicated allowlisted QA account on the **production** Convex deployment.

## Purpose

Use this when you need the QA account to behave like a brand-new user again for sign-in, onboarding, credits, or purchase-flow validation.

The shipped reset path deletes the QA user's:

- app user row (`users` — Convex data only; **WorkOS** sessions and hosted users are **not** deleted here)
- generations and generation ops events
- MCP API keys
- credit grants, pending checkouts, and purchase settlements
- reference upload rate-limit rows

It also deletes the generation-related storage files referenced by that user's history.

It does **not** delete Stripe customers or historical payments in Stripe itself.

## Command

```sh
pnpm reset-qa
```

That script reads the gate secret from the **production** Convex deployment and invokes the internal reset mutation for the dedicated QA email.

## Current target account

Today the script is intentionally hardcoded to:

```text
ycoklar@gmail.com
```

If that changes, update `scripts/reset-qa.ts` and the Convex allowlist together.

## Required Convex Production Env

Set these on the **production** deployment only:

- `QA_USER_RESET_SECRET`
- `QA_USER_RESET_ALLOWED_EMAILS`

`QA_USER_RESET_ALLOWED_EMAILS` is a comma-separated lowercase allowlist and must include the QA email used by the script.

## Prerequisites

- Logged into the Convex CLI with access to the production deployment
- `QA_USER_RESET_SECRET` is configured on prod
- `QA_USER_RESET_ALLOWED_EMAILS` is configured on prod

## What The Command Does

`pnpm reset-qa` runs `scripts/reset-qa.ts`, which:

1. reads `QA_USER_RESET_SECRET` from `convex env get ... --prod`
2. sends the secret plus the hardcoded QA email to `qaUserReset:resetAllowlistedTestUser`
3. prints a completion message telling you to sign in again via **WorkOS AuthKit** (e.g. Google through WorkOS)

The internal mutation refuses to run when:

- the secret is wrong or missing
- the email is not allowlisted
- the email belongs to a canary principal used by production verification

## Manual Fallback

If you need to run the mutation directly:

```sh
pnpm exec convex run --prod qaUserReset:resetAllowlistedTestUser '{"secret":"<QA_USER_RESET_SECRET>","email":"ycoklar@gmail.com"}'
```

You can also invoke it from the Convex dashboard if needed.

## After Reset

1. Sign in again through **WorkOS AuthKit** for the QA account (e.g. Google).
2. Confirm the app creates a fresh user row.
3. Re-run the flow you are validating, such as initial credits, Stripe checkout, or MCP API key creation.

## Source Of Truth

- `scripts/reset-qa.ts`
- `src/convex/qaUserReset.ts`
- `src/convex/lib/qaUserResetSecret.ts`
