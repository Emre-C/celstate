# Auth Cleanup Implementation Plan

## Goal

Complete the remaining auth modernization work with no legacy compatibility paths left behind.

Requested outcomes:

1. Remove backwards compatibility, stale auth fallbacks, and legacy code paths.
2. Remove email/password auth and replace it with Google + Apple social sign-in only.
3. Add regression tests so auth changes are caught early.
4. Create enduring product documentation for how auth works.

## Product decisions

- Celstate will support **social sign-in only**.
- Allowed providers will be:
  - `google`
  - `apple`
- Email/password sign-up and sign-in will be fully removed from both UI and server config.
- We will eliminate duplicate env-variable sources where practical and move to a **single canonical auth env contract**.
- Apple support will be implemented in a production-ready way, while making the local-development limitation explicit:
  - Apple Sign in for web requires HTTPS.
  - Apple cannot be fully exercised on `http://localhost`.

## Constraints that shape the implementation

### Apple local-development constraint

Based on the current Better Auth docs and Apple docs:

- Better Auth Apple provider requires `trustedOrigins: ["https://appleid.apple.com"]`.
- Apple web auth does not support non-TLS localhost return URLs.
- This means local dev can render the Apple button, but a real successful Apple redirect flow requires an HTTPS domain.

Implementation consequence:

- The code will support Apple fully.
- The UI will avoid pretending Apple is locally verifiable on `http://localhost`.
- The enduring docs will explicitly describe the Apple setup and local limitation.

## Canonical auth contract after cleanup

### Canonical server env vars

Auth server config should use only these canonical variables:

- `SITE_URL`
- `BETTER_AUTH_SECRET`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `AUTH_APPLE_ID`
- `AUTH_APPLE_SECRET`

Optional, if Apple native/iOS support is ever introduced later:

- `AUTH_APPLE_APP_BUNDLE_IDENTIFIER`

### Canonical public env vars

SvelteKit auth route plumbing should use only:

- `PUBLIC_SITE_URL`
- `PUBLIC_CONVEX_SITE_URL`

Any fallback to older or duplicate names should be removed.

## Exact file-by-file implementation plan

### 1. `src/convex/auth.ts`

#### Changes planned

- Remove `emailAndPassword` entirely.
- Remove Google env fallback order that still supports duplicate names.
- Add Apple provider configuration.
- Add `trustedOrigins: ["https://appleid.apple.com"]`.
- Fail fast when required provider credentials are missing.
- Keep Better Auth + Convex plugin wiring intact.

#### Target shape

- Use only canonical envs:
  - `AUTH_GOOGLE_ID`
  - `AUTH_GOOGLE_SECRET`
  - `AUTH_APPLE_ID`
  - `AUTH_APPLE_SECRET`
- Expose a small, testable helper for provider availability / config validation.
- `socialProviders` becomes the only auth entry point.

#### Intended outcome

- No email/password capability exists server-side.
- No ambiguous Google env precedence remains.
- Apple is configured according to current Better Auth docs.

### 2. `src/lib/auth-client.ts`

#### Changes planned

- Remove implicit fallback behavior where possible.
- Prefer `PUBLIC_SITE_URL` explicitly.
- Keep SSR-safe absolute URL handling.
- Potentially extract a small helper function so this can be tested directly.

#### Intended outcome

- Auth client base URL behavior is deterministic.
- We stop relying on unnecessary compatibility logic.

### 3. `src/routes/api/auth/[...all]/+server.ts`

#### Changes planned

- Remove the fallback from `PUBLIC_CONVEX_SITE_URL` to transformed `PUBLIC_CONVEX_URL`.
- Require `PUBLIC_CONVEX_SITE_URL` explicitly.
- Fail fast if it is missing instead of silently guessing.

#### Intended outcome

- No legacy public Convex URL compatibility path remains.
- Better Auth handler configuration is explicit and stable.

### 4. `src/lib/server/auth.ts`

#### Changes planned

- Keep the cookie extraction behavior that is required for Better Auth + Convex.
- Extract pure helper functions that can be unit tested:
  - auth cookie name resolution
  - token presence detection
  - initial auth state derivation
- Remove any logic that is not required by the current Better Auth cookie contract.

#### Intended outcome

- Route guard/session bootstrap logic is easy to test.
- Shared auth server behavior is centralized.

### 5. `src/routes/+layout.server.ts`

#### Changes planned

- Keep the current responsibility: feed initial auth state from cookies.
- Update imports if helper extraction changes.

#### Intended outcome

- No behavioral expansion.
- Remains a thin boundary layer.

### 6. `src/hooks.server.ts`

#### Changes planned

- Keep the current responsibility: set `event.locals.token` from auth cookies.
- Update imports if helper extraction changes.

#### Intended outcome

- No auth logic duplication.

### 7. `src/routes/(app)/+layout.server.ts`

#### Changes planned

- Preserve the protected-route redirect behavior.
- Potentially extract the redirect target logic into a testable helper if useful.

#### Intended outcome

- Members-only routes keep server-side protection.
- Redirect behavior is covered by tests.

### 8. `src/routes/auth/+page.svelte`

#### Changes planned

- Remove the entire email/password form.
- Remove sign-in/sign-up tabs and all related state:
  - `mode`
  - `name`
  - `email`
  - `password`
  - `submitting`
  - `handleSubmit`
- Replace with a polished social-only auth screen.
- Add explicit Google button.
- Add explicit Apple button.
- Use provider-specific submitting state rather than email form state.
- Show a clear message that Celstate supports trusted identity providers only.
- Potentially disable or annotate Apple in local non-HTTPS dev to avoid misleading failures.

#### Intended outcome

- The page matches the product decision: no random email/password accounts.
- Auth UX is simpler and more polished.
- Only supported auth options are presented.

### 9. `src/routes/+layout.svelte`

#### Changes planned

- Keep the Better Auth client initialization.
- Remove any unnecessary auth expectation or legacy glue if the current wrapper supports simplification.
- Keep Svelte 5 rune-compatible integration patterns.

#### Intended outcome

- Global auth bootstrapping stays minimal and forward-looking.

### 10. `src/routes/(app)/app/+layout.svelte`

#### Changes planned

- Keep sign-out behavior.
- Verify no email-specific assumptions exist.
- Ensure authenticated user bootstrap remains compatible with social-only auth.

#### Intended outcome

- Workspace shell remains unchanged from the user’s perspective except for cleaner auth architecture.

## New helper files likely to be added

### 11. `src/lib/auth/config.ts`

#### Purpose

Create a single canonical source of truth for auth provider/env configuration that can be imported by:

- `src/convex/auth.ts`
- tests
- possibly server/UI availability logic

#### Expected contents

- provider env parsing helpers
- provider availability metadata
- canonical env names
- fail-fast validation helpers

#### Intended outcome

- Removes config duplication.
- Makes auth behavior testable without hitting the whole app.

### 12. `src/lib/auth/providers.ts` or similar

#### Purpose

Provide UI-safe provider descriptors for rendering social login buttons.

#### Expected contents

- provider metadata for `google` and `apple`
- labels / identifiers
- possibly local-availability hinting for Apple

#### Intended outcome

- Auth page remains declarative and testable.

## Regression test plan

### Why new tooling is needed

The current project does not have a test runner installed.

Observed state:

- no existing project test files
- `vitest` is not installed as a dev dependency
- `pnpm exec vitest --version` currently fails

### Planned tooling changes

#### 13. `package.json`

Add dev dependencies and scripts for regression tests.

Likely additions:

- `vitest`

Likely scripts:

- `test`: `vitest run`
- `test:watch`: `vitest`

If needed for environment simulation, also consider:

- `@types/node`
  - only if test typing needs it beyond current setup

### 14. `vite.config.ts`

#### Changes planned

Add Vitest config via Vite config, following current Vitest guidance.

Likely test config:

- `environment: "node"`
- include patterns for `*.test.ts`

#### Intended outcome

- Minimal test configuration.
- No separate config file unless needed.

### 15. `src/lib/server/auth.test.ts`

#### Tests planned

- token extraction from the Better Auth Convex cookie name
- secure cookie fallback handling
- unauthenticated state derivation
- authenticated state derivation

#### Intended outcome

- Route/session bootstrap logic is protected from regressions.

### 16. `src/lib/auth/config.test.ts`

#### Tests planned

- canonical provider env parsing
- Google provider requires `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET`
- Apple provider requires `AUTH_APPLE_ID` + `AUTH_APPLE_SECRET`
- duplicate legacy envs are ignored once cleanup is complete
- trusted-origin config includes Apple origin when Apple is enabled

#### Intended outcome

- Auth configuration regressions are caught without needing E2E.

### 17. `src/routes/(app)/guard.test.ts` or helper test

#### Tests planned

If redirect logic is extracted to a helper:

- unauthenticated request redirects to `/auth?redirectTo=...`
- current path + query string are preserved correctly

If not extracted:

- add a small pure helper just for redirect URL construction and test that instead

#### Intended outcome

- Protected-route behavior is locked down.

## Enduring auth documentation plan

### 18. `docs/product/AUTH.md`

#### Purpose

Create the long-lived product/engineering auth reference.

#### Sections planned

- auth goals and product rationale
- supported providers
- why email/password is intentionally not supported
- current architecture map
- request flow end-to-end
- Better Auth + Convex integration details
- cookies / SSR / route guarding
- env variable contract
- local development constraints
- Apple setup details
- operational checklist for rotating secrets / adding providers later
- what is intentionally out of scope

#### Intended outcome

- Future work has a single durable source of truth.

## Additional cleanup candidates

These will be reviewed during implementation and removed if confirmed unused for the new architecture:

- old Google duplicate env fallback logic
- fallback from `PUBLIC_CONVEX_URL` to transformed site URL
- any lingering email-auth copy or state in the auth page
- any doc references that imply email/password is supported

Potential runtime env cleanup recommendations will also be produced for:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `HOSTING_URL`
- `SERVICE_KEY`
- any stale auth-era variables no longer required by the active stack

## Validation plan after implementation

### Static validation

- `pnpm exec svelte-check --tsconfig ./tsconfig.json`
- `pnpm test`

### Runtime validation

- run `pnpm dev`
- verify `/auth` renders only Google + Apple options
- verify `/app` redirects unauthenticated users to `/auth?redirectTo=%2Fapp`
- verify Google handoff still reaches Google login screen
- verify Apple button behavior matches the documented local-dev limitation

### Convex validation

- confirm canonical envs are present
- confirm no server-side Better Auth config error is thrown at startup
- inspect Convex logs for auth route errors

## Risks and mitigations

### Risk: Apple cannot be fully tested on localhost

Mitigation:

- implement provider according to current Better Auth + Apple docs
- document the limitation clearly
- keep Google as the locally verifiable provider

### Risk: removing env fallbacks can break hidden deployment assumptions

Mitigation:

- use fail-fast validation with clear error messages
- document canonical env contract in `docs/product/AUTH.md`

### Risk: auth UI refactor could leave the protected-route flow inconsistent

Mitigation:

- keep server-side route guard unchanged in intent
- add regression tests around token/bootstrap/redirect logic
- rerun browser-level Google flow validation after changes

## Summary of expected file edits

### Existing files to modify

- `package.json`
- `vite.config.ts`
- `src/convex/auth.ts`
- `src/lib/auth-client.ts`
- `src/lib/server/auth.ts`
- `src/routes/api/auth/[...all]/+server.ts`
- `src/routes/+layout.server.ts`
- `src/hooks.server.ts`
- `src/routes/+layout.svelte`
- `src/routes/(app)/+layout.server.ts`
- `src/routes/(app)/+layout.svelte`
- `src/routes/auth/+page.svelte`

### New files likely to add

- `src/lib/auth/config.ts`
- `src/lib/auth/config.test.ts`
- `src/lib/server/auth.test.ts`
- optional redirect-helper test file if helper extraction is used
- `docs/product/AUTH.md`

## Execution order

1. Create shared canonical auth config helpers.
2. Refactor Convex Better Auth server config to social-only Google + Apple.
3. Remove auth route email/password UI and switch to social-only UX.
4. Remove legacy public/server env fallbacks.
5. Add Vitest and auth regression tests.
6. Write `docs/product/AUTH.md`.
7. Run static checks and tests.
8. Re-run local browser validation through the Google login screen.

## Notes for implementation

- Follow Svelte 5 rune patterns.
- Do not introduce React.
- Keep code immediately runnable.
- Prefer pure helpers for testability.
- Do not preserve backwards compatibility unless it is strictly required by the active architecture.
