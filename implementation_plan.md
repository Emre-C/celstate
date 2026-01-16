# Convex Auth Implementation Plan

Status: Draft
Owner: TBD

## Scope
- Enable first-party user authentication using Convex Auth.
- Provide a React (Vite) entry point for sign-in/sign-out that we can later extend into a dashboard.
- Add the minimum backend authorization primitives needed for user-scoped data access.

Out of scope for this plan:
- Dashboard UX, asset generation UI, API key issuance/management.
- Non-Convex auth providers (Clerk, Auth0, etc.).

## Current Context (Codebase Touchpoints)
- Convex schema and functions live in `convex/` (`convex/schema.ts`, `convex/jobs.ts`, `convex/assets.ts`).
- Python pipeline syncs jobs and assets into Convex via `src/celstate/convex_sync.py` using `CONVEX_URL`.
- Marketing landing page is static HTML at `landing/index.html` (no React app exists yet).
- Node dependencies are minimal (`package.json` currently only includes `convex`).

## Preflight Decisions (Must Set Before Coding)
1. **Auth provider to start**: Google OAuth.
2. **Frontend app location**: Create a new Vite app in `web/` and keep `landing/` static.
3. **Service-to-Convex trust model**: Use dedicated service-only mutations gated by a shared service key (keeps user-facing APIs private while preserving pipeline sync).
4. **User profile table naming**: `userProfiles` (avoid collisions with `authTables`).

## Phase 0: Documentation Verification (Required Before Implementation)
- Use `web_search` to confirm current Convex Auth docs and file scaffolding for:
  - `@convex-dev/auth` setup and generated files.
  - Provider configuration for the chosen auth method.
  - `authTables` table names (to avoid schema collisions).
- Confirm dependency versions compatible with existing `convex` version in `package.json`.
  - **Verified (Jan 15 2026):**
    - Install: `npm install @convex-dev/auth @auth/core@0.37.0`.
    - Init: `npx @convex-dev/auth` (or manual setup) to add `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts`, and `generateKeys.mjs`.
    - Auth tables: `authTables` from `@convex-dev/auth/server`.
    - Google OAuth env vars: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.
    - Convex Auth env vars: `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS`.
    - OAuth callback: `https://<deployment>.convex.site/api/auth/callback/google`.
    - Authorized JS origin (local): `http://localhost:5173`.

## Phase 1: Backend Scaffolding (Convex Auth)
1. Add dependencies:
   - `@convex-dev/auth` and `@auth/core@0.37.0`.
2. Run the setup tool:
   - `npx @convex-dev/auth` (preferred) to generate baseline files.
3. Verify generated files (expected, exact names from docs):
   - `convex/auth.ts` (server-side auth helpers).
   - `convex/auth.config.ts` or `convex/auth.config.js` (provider config).
   - `convex/http.ts` with `auth.addHttpRoutes(http)`.
   - `generateKeys.mjs` for `JWT_PRIVATE_KEY`/`JWKS` generation.
4. Update `convex/schema.ts`:
   - Import `authTables` from `@convex-dev/auth/server`.
   - Merge `authTables` with existing tables (`jobs`, `jobAssets`, `jobEvents`).
   - Confirm no table name collisions.

## Phase 2: Auth Provider Configuration
1. Configure Google OAuth in `convex/auth.config.ts` based on docs (verify exact provider config shape).
2. Add required environment variables (exact names from docs), expected to include:
   - `SITE_URL` (frontend origin for OAuth redirects; e.g., `http://localhost:5173`).
   - `JWT_PRIVATE_KEY` + `JWKS` (from `node generateKeys.mjs`).
   - `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` (Google OAuth client).
3. Configure Google OAuth client in Google Cloud:
   - Authorized JS origin: `http://localhost:5173` (adjust for prod).
   - Redirect URI: `https://<deployment>.convex.site/api/auth/callback/google`.
3. Document how these env vars are managed for:
   - Local dev (e.g., `.env.local`).
   - Production deployment (Convex dashboard secrets).

## Phase 3: Frontend Bootstrapping (React + Convex Auth)
1. Create the React (Vite) app in the chosen location.
2. Install frontend dependencies:
   - `convex`, `@convex-dev/auth`, `@auth/core` (if not already in that package).
3. Wrap the app with `ConvexAuthProvider`:
   - Instantiate `ConvexReactClient` using `VITE_CONVEX_URL`.
   - Place provider in `src/main.tsx`.
4. Implement a minimal auth UI:
   - `SignIn` component using `useAuthActions`.
   - `SignOut` component using `useAuthActions`.
   - Gate UI using `AuthLoading`, `Authenticated`, `Unauthenticated`.

## Phase 4: Entry Point Wiring (Landing -> Auth)
1. Update `landing/index.html` CTA(s) to link to the new app entry point.
2. Add a `/login` (or `/`) route in the React app to show the sign-in UI.
3. Ensure the landing page does not directly embed auth logic; keep it a simple entry point.

## Phase 5: Backend Authorization Skeleton
1. Add an auth helper (using Convex Auth `auth` helper) to require a signed-in user.
2. Add user ownership to data model (recommended):
   - Add `ownerId` to `jobs`, `jobAssets`, `jobEvents` (optional at first to avoid breaking sync).
3. Create user-scoped queries/mutations:
   - `jobs:listForCurrentUser` to return jobs where `ownerId` matches signed-in user.
   - Future-safe placeholders for `assets:listForCurrentUser`.
4. Preserve pipeline sync:
   - Keep `jobs:upsert` and `assets:save` as service-only mutations.
   - Require a shared service key (env secret) to call these mutations from the Python pipeline.
   - Provide parallel user-facing queries/mutations that always require a signed-in user.

## Phase 6: Verification and Acceptance
- Local validation checklist:
  1. `npx convex dev` runs without schema errors.
  2. User can sign in and sign out in the React app.
  3. Auth tables populate in Convex data viewer.
  4. `jobs:listForCurrentUser` rejects unauthenticated requests.
  5. Python sync still uploads jobs/assets when service auth is provided.
- Document exact manual steps and expected outcomes for each check.

## Deliverables
- New Convex Auth files: `convex/auth.ts`, `convex/auth.config.ts`.
- Updated `convex/schema.ts` with `authTables` merged.
- New React (Vite) app with `ConvexAuthProvider` and basic auth UI.
- Landing page CTA wired to the auth entry point.
- Auth-protected query/mutation stubs for user-scoped access.
- Environment variable documentation for local and production.

## Risks and Mitigations
- **Schema collision with `authTables`**: verify table names before adding any `users` table.
- **Breaking pipeline sync**: introduce service-only auth path or service key check before gating mutations.
- **Incorrect callback domains**: ensure `CONVEX_SITE_URL` matches the frontend origin in each environment.
- **Provider setup drift**: re-check Convex Auth docs before implementation and lock versions in `package.json`.
