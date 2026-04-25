# Codebase hygiene, static analysis, and audits

Operator reference for **local quality gates**, **Knip**, and **periodic codebase audits**. Complements [`CI-AND-CANARIES.md`](./CI-AND-CANARIES.md) (what CI runs) and [`PUBLIC-ENV-CHECKLIST.md`](./PUBLIC-ENV-CHECKLIST.md).

## Local verification tiers

Use the right depth for the change:

| Tier | When | Commands |
|------|------|----------|
| **Fast gate** | Everyday edits; PRs that skip E2E locally | `pnpm check`, `pnpm typecheck:tsc`, `pnpm lint:ts`, `pnpm test` |
| **Full repo gate** | Before merge when touching routing, auth, Convex HTTP, or release-sensitive paths; mirrors most of CI | `pnpm verify` (includes Knip, jscpd, `pnpm build`, `pnpm test:e2e`) |

CI’s `ci.yml` runs `pnpm verify` (see [CI-AND-CANARIES.md](./CI-AND-CANARIES.md)). Do not claim the full gate passed unless you actually ran `pnpm verify` on the branch you are handing off.

## Knip (unused code)

Default project config is tuned for Convex + SvelteKit. **Interpret stricter modes carefully:**

```sh
pnpm knip
pnpm knip --include-entry-exports
pnpm knip --production
```

- **`pnpm knip`** — Primary signal. Exit **0** means no actionable default report for this repo.
- **`pnpm knip --include-entry-exports`** — Often exits **non-zero** with many “unused exports.” A large share are **false positives**: Convex functions are referenced via generated **`api.*` / `internal.*` string paths** and static analysis does not always see those edges. Example: symbols in `src/convex/mcp/keys.ts` (e.g. `createKey`) are invoked through the generated API, not as direct ES imports from app code.
- **`pnpm knip --production`** — May list “unused dependencies” that are still required from **Convex actions**, **scripts**, or other paths outside the production entry graph.

Do not treat either stricter mode as a bulk-delete checklist without proving live references (grep generated usage, Convex dashboard, or runtime).

## Try/catch and legacy-marker sweeps

Useful for audit passes or refactors; rerun the same commands to compare over time.

**PowerShell** (line count for lines containing `try` — not identical to “try/catch block count” but stable):

```powershell
(git grep -n '\btry\b' -- src/ | Measure-Object -Line).Lines
git grep -n '\btry\b' -- src/
```

**Markers** (`@deprecated`, TODO-class tags, etc.):

```sh
git grep -nE '@deprecated|TODO|FIXME|HACK|XXX|legacy|fallback' -- src/
```

Treat remaining hits as **evidence to read**, not automatic debt: some markers describe **paused product behavior** (for example Apple Sign-In) rather than dead code.

## Cleanup audit artifacts

Point-in-time cleanup reviews and handoff evidence may live under:

```text
docs/audits/
```

Example: [`docs/audits/2026-04-24-cleanup-audit.md`](../audits/2026-04-24-cleanup-audit.md) (2026-04-24 cleanup integration on `main`, plus remediation notes on the branch that fixed handoff gaps).

## HTTP helper modules vs verification routes

`src/convex/lib/httpResponses.ts` was removed in favor of **inlining** small JSON/Bearer helpers in `src/convex/http.ts` for `/verification/*` routes. **Do not reintroduce a shared `httpResponses` module** for cosmetic DRY without revisiting typing and error-classifier decisions documented in that audit brief.

**Bearer parsing** intentionally differs between verification routes and MCP; see [`docs/conventions/convex.md`](../conventions/convex.md) and [`docs/product/mcp-server.md`](../product/mcp-server.md).

## Related docs

- [`docs/runbooks/CI-AND-CANARIES.md`](./CI-AND-CANARIES.md) — CI workflows and production verification
- [`docs/product/mcp-server.md`](../product/mcp-server.md) — MCP surface, auth, tool contract
- [`docs/conventions/convex.md`](../conventions/convex.md) — Convex patterns and HTTP auth boundaries
