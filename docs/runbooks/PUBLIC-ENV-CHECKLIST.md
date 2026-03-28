# Public env checklist (stop dev / preview / prod drift)

SvelteKit exposes `PUBLIC_*` variables to the client. Anything imported from `$env/static/public` (including inside dependencies such as `@mmailaender/convex-better-auth-svelte`) **must exist at build time** in that environment. Missing keys → Rollup error: `"PUBLIC_*" is not exported by virtual:env/static/public`.

## Roles (three different URLs)

| Variable | Role |
|----------|------|
| `PUBLIC_SITE_URL` | **This SvelteKit app** — canonical origin (e.g. `https://your-app.vercel.app`). Used for auth client base URL, canonical host redirects, and marketing SEO/social metadata (`rel=canonical`, `og:url`, absolute `og:image` on the landing page). |
| `PUBLIC_CONVEX_URL` | **Convex realtime / client API** — `https://<deployment>.convex.cloud` (or loopback when using local Convex). |
| `PUBLIC_CONVEX_SITE_URL` | **Optional.** Only when `PUBLIC_CONVEX_URL` is loopback: set to the **same deployment’s** `https://<deployment>.convex.site` so Better Auth HTTP routes resolve. If `PUBLIC_CONVEX_URL` is already `*.convex.cloud`, omit this — the app derives `*.convex.site`. |

Convex secrets and `SITE_URL` **inside Convex** are separate; see [CONVEX-VERCEL-ENVIRONMENTS.md](./CONVEX-VERCEL-ENVIRONMENTS.md).

### What `pnpm check:public-env` requires for `PUBLIC_SITE_URL`

`scripts/check-public-env.ts` parses the value with `new URL(...)` and **must** accept it as an origin-only `http(s)` URL:

- Protocol is `http:` or `https:` only.
- No userinfo, query string, or fragment.
- Pathname must be empty or `/` (so the value denotes an origin, not a path). A trailing slash alone is fine; validation normalizes to `u.origin`.

That keeps client-built absolute URLs for SEO and Open Graph consistent with the host enforced in `src/hooks.server.ts` and `src/lib/server/canonical-site.ts`.

## Rules that prevent ping-pong

1. **Vercel has two deployment targets:** **Production** (e.g. `vercel --prod`, production branch) and **Preview** (everything else: `vercel` without `--prod`, deploy previews, etc.). They use **separate env lists**. You do **not** need multiple Git branches or a “team workflow” — a solo `main` repo still gets Preview deployments whenever you run a non-production deploy. **Each `PUBLIC_*` name must exist for both targets** if you use both kinds of deploys; otherwise Preview builds fail while Production works.
2. **Fastest fix (Dashboard):** **Settings → Environment Variables** → open each `PUBLIC_*` → enable **Preview** and **Production** with the same values → **Save** → **Redeploy**. No branch picker required.
3. **Local:** keep `.env` / `.env.local` aligned with the Convex deployment you run (`pnpm dev` = `convex dev` + Vite). Run `pnpm check:public-env` and `pnpm check:convex-auth` after changing URLs.
4. **CI:** GitHub Actions sets the same variable **names** as Vercel (placeholder values) so `pnpm check:public-env` and `pnpm build` succeed without real secrets. **`PUBLIC_SITE_URL` in CI is intentionally `http://127.0.0.1:4174`** so it matches the **`vite preview`** origin used by **`pnpm test:e2e`** (`playwright.config.ts`). That way canonical redirects in `src/hooks.server.ts` do not send the test browser off localhost during the marketing landing smoke test. This is **not** your production hostname—Vercel Preview and Production still use your real canonical origin. Update `.github/workflows/ci.yml` if you add a new `PUBLIC_*` static import.
5. **Before changing prod Convex URL:** update Vercel env **and** redeploy; update local `.env.local`; run `pnpm check:public-env`.

### CLI note (non-interactive Preview)

`vercel env add NAME preview` sometimes asks for a **Git branch** because Preview env can be scoped per branch. If you only use `main` (production branch), the CLI may refuse `main` for Preview. The **Dashboard** checkbox for Preview is the reliable fix; alternatively use the [REST API](https://vercel.com/docs/rest-api/reference/endpoints/projects/create-one-or-more-environment-variables) with `target: ["preview"]` and a `VERCEL_TOKEN`.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm check:public-env` | Validates URL shapes and Convex site derivation (no network). |
| `pnpm check:ui-contracts` | Static guard for known-bad patterns (e.g. JSON-LD in `(marketing)/+page.svelte` that caused Svelte hydration mismatch). |
| `pnpm check:convex-auth` | GETs Better Auth session on resolved `*.convex.site` (needs `pnpm dev`). |
| `pnpm test:e2e` | Playwright: production build + `vite preview`; asserts marketing `/` hydrates without `hydration_mismatch` (see `e2e/`). |
| `pnpm verify` | Full gate: `check:public-env`, `check:ui-contracts`, `svelte-check`, Knip, jscpd, ESLint, Vitest, `vite build`, `test:e2e`. Wrapped with `PUBLIC_SITE_URL=http://127.0.0.1:4174` in `package.json` so the build matches E2E preview. |
| `vercel env ls` | Confirm Preview **and** Production have `PUBLIC_*`. |

## Repo template

Copy [.env.example](../../.env.example) to `.env.local` and replace placeholders.
