# Convex Auth Implementation Plan

Status: **Complete** — Phases 0–6 complete
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

---

## Phase 0: Documentation Verification ✅ COMPLETE
- Verified Convex Auth docs (Jan 15 2026):
  - Install: `npm install @convex-dev/auth @auth/core@0.37.0`.
  - Auth tables: `authTables` from `@convex-dev/auth/server`.
  - Google OAuth env vars: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.
  - Convex Auth env vars: `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS`.
  - OAuth callback: `https://<deployment>.convex.site/api/auth/callback/google`.
  - Authorized JS origin (local): `http://localhost:5173`.

## Phase 1: Backend Scaffolding ✅ COMPLETE
Files created:
- `convex/auth.js` — Google provider configured via `convexAuth()`.
- `convex/auth.config.js` — Provider configuration.
- `convex/http.js` — HTTP routes for OAuth callbacks.
- `convex/schema.ts` — Updated with `...authTables` merged.
- `generateKeys.mjs` — Script to generate `JWT_PRIVATE_KEY`/`JWKS`.

## Phase 2: Auth Provider Configuration ✅ COMPLETE
Environment variables required (set in Convex dashboard + `.env.local`):
- `SITE_URL` — Frontend origin (e.g., `http://localhost:5173`).
- `JWT_PRIVATE_KEY` + `JWKS` — Generated via `node generateKeys.mjs`.
- `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` — Google OAuth client credentials.

Google Cloud Console configuration:
- Authorized JS origin: `http://localhost:5173` (local), production URL (prod).
- Redirect URI: `https://<deployment>.convex.site/api/auth/callback/google`.

## Phase 3: Frontend Bootstrapping ✅ COMPLETE
Created `web/` Vite React app:
- `web/src/main.tsx` — `ConvexAuthProvider` wrapping the app with `ConvexReactClient`.
- `web/src/App.tsx` — Routes using `AuthLoading`, `Authenticated`, `Unauthenticated`.
- `web/src/components/SignIn.tsx` — Google OAuth button using `useAuthActions`.
- `web/src/components/Dashboard.tsx` — Sign out button + placeholder dashboard UI.
- Styling matches landing page aesthetic (Instrument Serif, Geist Mono, DM Sans, #00ff88 accent).

Environment:
- `web/.env.local` — Contains `VITE_CONVEX_URL`.
- `web/.env.local.example` — Template for developers.

## Phase 4: Entry Point Wiring ✅ COMPLETE
- `landing/index.html` nav CTA → `/app/` with "Sign In" text.
- `landing/index.html` main CTA → `/app/` with "Get Started" text.
- `web/` SignIn back link → `/landing/`.
- `web/` Dashboard footer link → `/landing/`.



---

## Phase 5: Backend Authorization Skeleton ✅ COMPLETE

**Deployment note**: Configure server to serve `landing/` at `/landing/` and `web/dist/` at `/app/`.

1. Added auth helpers in `convex/lib/auth.ts`:
   - `requireAuth(ctx)` throws on unauthenticated requests.
   - `checkServiceKey(serviceKey)` validates `SERVICE_KEY` for service-only mutations.

2. Added `ownerId` (optional) to `jobs`, `jobAssets`, `jobEvents` schema plus `by_owner` indexes.

3. Implemented user-scoped queries:
   - `jobs:listForCurrentUser` returns user-owned job metadata.
   - `assets:listForCurrentUser` returns user-owned assets with resolved URLs.

4. Preserved pipeline sync with service-only mutations:
   - `jobs:upsert`, `assets:generateUploadUrl`, `assets:save` accept `serviceKey` and allow service calls without auth.
   - Python `ConvexSync` now requires `SERVICE_KEY` and sends it with mutations.

## Phase 6: Verification and Acceptance ✅ COMPLETE
Local validation checklist:
1. [x] `npx convex dev` runs without schema errors.
2. [x] User can sign in via Google OAuth in the React app.
3. [x] User can sign out.
4. [x] Auth tables (`users`, `sessions`, etc.) populate in Convex data viewer.
5. [x] `jobs:listForCurrentUser` rejects unauthenticated requests.
6. [x] Python sync still uploads jobs/assets with service key.

---

## Deliverables
- [x] Convex Auth files: `convex/auth.js`, `convex/auth.config.js`, `convex/http.js`.
- [x] Updated `convex/schema.ts` with `authTables` merged.
- [x] React (Vite) app in `web/` with `ConvexAuthProvider` and auth UI.
- [x] Landing page CTAs wired to auth entry point.
- [x] Auth-protected query/mutation stubs for user-scoped access.
- [x] Environment variable documentation for local and production.

## Risks and Mitigations
- **Schema collision with `authTables`**: ✅ Verified — no collisions.
- **Breaking pipeline sync**: Mitigate with service key pattern in Phase 5.
- **Incorrect callback domains**: Ensure `SITE_URL` matches frontend origin per environment.
- **Provider setup drift**: Versions locked in `package.json`.
