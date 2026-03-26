# Public env checklist (stop dev / preview / prod drift)

SvelteKit exposes `PUBLIC_*` variables to the client. Anything imported from `$env/static/public` (including inside dependencies such as `@mmailaender/convex-better-auth-svelte`) **must exist at build time** in that environment. Missing keys → Rollup error: `"PUBLIC_*" is not exported by virtual:env/static/public`.

## Roles (three different URLs)

| Variable | Role |
|----------|------|
| `PUBLIC_SITE_URL` | **This SvelteKit app** — canonical origin (e.g. `https://your-app.vercel.app`). Used for auth client base URL and canonical redirects. |
| `PUBLIC_CONVEX_URL` | **Convex realtime / client API** — `https://<deployment>.convex.cloud` (or loopback when using local Convex). |
| `PUBLIC_CONVEX_SITE_URL` | **Optional.** Only when `PUBLIC_CONVEX_URL` is loopback: set to the **same deployment’s** `https://<deployment>.convex.site` so Better Auth HTTP routes resolve. If `PUBLIC_CONVEX_URL` is already `*.convex.cloud`, omit this — the app derives `*.convex.site`. |

Convex secrets and `SITE_URL` **inside Convex** are separate; see [CONVEX-VERCEL-ENVIRONMENTS.md](./CONVEX-VERCEL-ENVIRONMENTS.md).

## Rules that prevent ping-pong

1. **Vercel has two deployment targets:** **Production** (e.g. `vercel --prod`, production branch) and **Preview** (everything else: `vercel` without `--prod`, deploy previews, etc.). They use **separate env lists**. You do **not** need multiple Git branches or a “team workflow” — a solo `main` repo still gets Preview deployments whenever you run a non-production deploy. **Each `PUBLIC_*` name must exist for both targets** if you use both kinds of deploys; otherwise Preview builds fail while Production works.
2. **Fastest fix (Dashboard):** **Settings → Environment Variables** → open each `PUBLIC_*` → enable **Preview** and **Production** with the same values → **Save** → **Redeploy**. No branch picker required.
3. **Local:** keep `.env` / `.env.local` aligned with the Convex deployment you run (`pnpm dev` = `convex dev` + Vite). Run `pnpm check:public-env` and `pnpm check:convex-auth` after changing URLs.
4. **CI:** GitHub Actions sets the same variable **names** as Vercel (placeholder values) so `pnpm check:public-env` and `pnpm build` match what happens on Vercel. Update `.github/workflows/ci.yml` if you add a new `PUBLIC_*` static import.
5. **Before changing prod Convex URL:** update Vercel env **and** redeploy; update local `.env.local`; run `pnpm check:public-env`.

### CLI note (non-interactive Preview)

`vercel env add NAME preview` sometimes asks for a **Git branch** because Preview env can be scoped per branch. If you only use `main` (production branch), the CLI may refuse `main` for Preview. The **Dashboard** checkbox for Preview is the reliable fix; alternatively use the [REST API](https://vercel.com/docs/rest-api/reference/endpoints/projects/create-one-or-more-environment-variables) with `target: ["preview"]` and a `VERCEL_TOKEN`.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm check:public-env` | Validates URL shapes and Convex site derivation (no network). |
| `pnpm check:convex-auth` | GETs Better Auth session on resolved `*.convex.site` (needs `pnpm dev`). |
| `vercel env ls` | Confirm Preview **and** Production have `PUBLIC_*`. |

## Repo template

Copy [.env.example](../../.env.example) to `.env.local` and replace placeholders.
