# Codebase Cleanup Audit Brief — 2026-04-24

## Remediation handoff

This brief was updated on branch `audit/cleanup-gap-remediation` (historical one-off plan now retired — see [`docs/implementation/CLEANUP-AUDIT-GAP-REMEDIATION-PLAN.md`](../implementation/CLEANUP-AUDIT-GAP-REMEDIATION-PLAN.md)). **Maintainer-facing** summaries of verification tiers, Knip, and related commands live in [`docs/runbooks/CODEBASE-HYGIENE.md`](../runbooks/CODEBASE-HYGIENE.md).

**Compile fix on this branch:** `main` at `d27fd7b` still imported deleted `./lib/httpResponses.js`. The remediation inlines `jsonResponse`, `parseBearer`, and `jsonRouteHandler` in `src/convex/http.ts` (the module stays deleted; this is not a re-extraction).

## Scope

On 2026-04-24, 8 scoped cleanup passes were run against `main`. This brief tells an auditor what landed, what was deliberately skipped, and what to verify.

- **Starting commit**: `bc6000e` (pre-cleanup)
- **Final commit**: `d27fd7b` on `main`, 13 commits ahead
- **Net change**: 16 files, +104 / −189 lines (see §7)
- **Locally rerun on this branch (2026-04-24):** `pnpm check`, `pnpm typecheck:tsc`, `pnpm lint:ts`, `pnpm test` — all succeeded (see §7 for transcripts).
- **Full repo gate also rerun:** `pnpm verify` succeeded (includes `pnpm build` and `pnpm test:e2e`).
- **Execution model**: 8 orthogonal passes in isolated git worktrees, merged on a `cleanup/integration` branch, fast-forwarded onto `main`

## 1. Cleanup passes — one line each

| # | Pass | Outcome |
|---|------|---------|
| 1 | DRY / deduplicate | Landed + **partially reverted** (see §3, `httpResponses.ts`) |
| 2 | Consolidate type definitions | Landed |
| 3 | Remove unused code (knip) | **No-op** — zero real positives |
| 4 | Untangle circular dependencies (madge) | Landed |
| 5 | Remove weak types (`any`/`unknown`) | Landed (1 fix applied after) |
| 6 | Remove defensive try/catch | **No-op** — audited; see §4 for rerun |
| 7 | Remove legacy / deprecated / fallback code | **No-op** — markers are active business state |
| 8 | Remove AI slop / unhelpful comments | Landed |

## 2. Per-commit audit checklist

Audit each commit in order. For each: read the diff, confirm scope matches the description, verify no regression.

```bash
git log --oneline bc6000e..d27fd7b
```

| Commit | Subject | What to verify |
|---|---|---|
| `940265f` | refactor(types): consolidate duplicate GenerationStage and auth-provider unions | `GenerationStage` union members identical at every call site; `ResolvedAuthProvider = AuthProviderId \| 'unknown'` preserves the `'unknown'` literal end-to-end through Convex validators |
| `2aa1d9a` | refactor(convex): extract shared HTTP helpers for verification routes | Short-lived — see §3. `d27fd7b` deleted `httpResponses.ts`; this branch inlines the small helpers still required by `/verification/*` routes (see remediation handoff). |
| `83793a9` | chore: trim AI-slop comments | Only comment changes; no semantic deltas |
| `5a1e055` | refactor(convex): replace `any` with precise types | Every replacement actually compiles (ties in with `c47c842`) |
| `3298a3a` | refactor(mcp): extract `McpToolContext` to leaf module | New `src/convex/mcp/context.ts` exists; tool modules import from leaf; no `tools → handler` cycle |
| `4282675` / `788f786` / `012b0cf` / `2ec4dcb` / `fc5175b` | 5 integration merge commits | Pure merges — confirm no content is snuck in |
| `357af49` | refactor(mcp): drop `McpToolContext` back-compat re-export | No external consumer still imports `McpToolContext` from `handler.ts` |
| `c47c842` | fix(convex): drop spurious undefined from pendingCheckoutId shape | Matches `purchaseSettlements` schema (`pendingCheckoutId: v.union(v.id("pendingCheckouts"), v.null())` — non-optional) |
| `d27fd7b` | revert(convex): remove unused httpResponses helper | File deleted; **this branch** removes the stale import by inlining helpers (see handoff). |

## 3. Architectural decision worth scrutinizing

One cleanup pass overlapped a parallel in-flight refactor and was explicitly reverted on the winning approach:

**Decision**: `src/convex/http.ts` was originally refactored to use a shared `jsonResponse` / `parseBearer` / `jsonRouteHandler` helper module (`src/convex/lib/httpResponses.ts`). The in-flight WIP refactor used a different philosophy:
- `FunctionArgs<typeof internal.X>`-derived body types (stronger typing than the helper's casts)
- A typed `isVerificationUnauthorizedError` classifier instead of string-matching `"Unauthorized"`
- Explicit body-type aliases (e.g. `VerificationIngestBody`, `CanaryGenerationRequestBody`)

The WIP approach won. `httpResponses.ts` was deleted (`d27fd7b`). **The auditor should not re-propose extracting shared HTTP helpers** — that path was evaluated and rejected on typing grounds.

## 3b. Bearer parsing — intentional divergence

Bearer parsing still exists in two locations by design.

- **Verification HTTP routes** in `src/convex/http.ts` use an inline `parseBearer(request)` that requires a canonical `Bearer ` prefix (case-sensitive `startsWith("Bearer ")`) and returns an empty string when missing. That value flows into runner-secret verification and the `Unauthorized` / `jsonRouteHandler` classifier for those routes.
- **MCP** in `src/convex/mcp/handler.ts` uses `parseBearerToken` (`/^Bearer\s+(.+)$/i`), which is case-insensitive on the prefix and returns `null` when the header is missing or malformed, so bad API-key requests fail at the MCP HTTP auth boundary before protocol handling.

This divergence is intentional unless a future change first unifies both HTTP contracts. Do not merge these helpers in a cleanup pass without that product/API decision.

## 4. What was considered and deliberately NOT done

Do not raise these as missing work. Re-run the same commands to reproduce the conclusion:

```powershell
pnpm knip
pnpm knip --include-entry-exports
pnpm knip --production

# Line count for lines containing the word `try` (not identical to “try/catch blocks” but stable for reruns):
(git grep -n '\btry\b' -- src/ | Measure-Object -Line).Lines
git grep -n '\btry\b' -- src/

git grep -nE '@deprecated|TODO|FIXME|HACK|XXX|legacy|fallback' -- src/
```

Observed on this branch when the brief was updated:

- `pnpm knip` — exit **0** (no actionable default report).
- `pnpm knip --include-entry-exports` — exit **1** with a long list of “unused” exports; many are **Convex false positives** because functions are reached only via string-path references (`internal.*` / `api.*`) that static analysis does not follow. Example: `createKey` in `src/convex/mcp/keys.ts` is reported unused while MCP and clients invoke it through the generated API surface.
- `pnpm knip --production` — exit **1** with **9** “unused dependencies”; these are used from Convex actions, scripts, or other non–entry-file paths the production graph does not see.
- `try` grep — **47** lines in `src/` matched `\btry\b` at remediation time; conclusion unchanged: legitimate boundaries only.
- Marker grep — use output to re-audit; remaining markers are the known Apple Sign-In pause and similar **active** state (see bullets below).

Topic summaries:

- **Unused code removal (knip)** — default `pnpm knip` is clean; the stricter modes above surface expected noise, not new deletion work.
- **Defensive try/catch removal** — every audited block sits at a legitimate boundary (URL / JSON parsing, network retry, webhook handlers, Stripe actions, MCP protocol envelopes, sharp decode, UI error display, try/finally cleanup patterns).
- **Legacy / deprecated / fallback code** — every marker in `src/` was audited. All remaining markers are **active business state**, primarily the Apple Sign-In pause: touchpoints include `src/lib/auth/providers.ts`, `src/lib/auth/config.ts`, `src/lib/auth/config.test.ts`, and `src/routes/auth/+page.svelte`. These are restoration markers, not debt.
- **`verification.ts` weak-types via `Pick<MutationCtx, "runQuery">`** — superseded by the in-flight WIP's `BetterAuthLookupCtx` named alias.
- **`creditGrants.ts` inline settlement struct** — superseded by the WIP's shared `PurchaseSettlement` type.

## 5. Uncommitted WIP context (historical note)

At the time of the original cleanup, some workspaces carried substantial uncommitted WIP (QA reset, transparent QA helpers, reference-storage migration, etc.). That work is **outside** this audit scope unless a reviewer explicitly extends it.

## 6. Follow-up pass addressed same day

After the merge, a second pass was run against the WIP files the agents never saw:

- **Madge** — skipped because of a broken npx cache locally; import graph was verified manually to be strictly downward (no cycles).
- **Weak types** — one `unknown` across all 11 target files, at a legitimate `error: unknown` classifier parameter. No edits.
- **AI slop** — 2 uncommitted edits (production verification script comments; `cleanupOrphanedReferenceUploads` JSDoc in `generations.ts`).

Those edits were not necessarily in the `bc6000e..d27fd7b` commit range; treat this section as historical context.

## 7. Verification commands

### Fast audit gate (minimum local proof for this cleanup range)

```powershell
pnpm check          # svelte-check: expect 0 errors, 0 warnings
pnpm typecheck:tsc  # tsc --noEmit
pnpm lint:ts        # eslint
pnpm test           # vitest run
```

**Observed on `audit/cleanup-gap-remediation` (2026-04-24):**

- `pnpm check` — `svelte-check found 0 errors and 0 warnings`
- `pnpm typecheck:tsc` — success (exit 0)
- `pnpm lint:ts` — success (exit 0)
- `pnpm test` — `23` test files, `168` passed, `1` skipped

### Full repo gate (heavier CI-style pipeline)

```powershell
pnpm verify
```

Runs `check:public-env`, `check:ui-contracts`, then the fast gate steps, plus `pnpm knip`, `pnpm dupcheck`, `pnpm build`, and `pnpm test:e2e`.

**Observed:** completed successfully on the same branch/date (Playwright: 1 test passed).

### Historical range sanity checks

```bash
git log --oneline bc6000e..d27fd7b   # expect 13 commits
git diff --stat bc6000e..d27fd7b     # expect stats below
```

Expected net diff (from original cleanup):

```
 scripts/production-verification.ts |  27 +++-----
 src/convex/creditGrants.ts         |   8 +--
 src/convex/generation.ts           |  16 ++---
 src/convex/generations.ts          |  40 +++--------
 src/convex/http.ts                 | 135 +++++++++++--------------------------
 src/convex/lib/ops.ts              |   3 +-
 src/convex/mcp/context.ts          |  13 ++++
 src/convex/mcp/handler.ts          |  13 +---
 src/convex/mcp/keys.ts             |  10 ---
 src/convex/mcp/tools/credits.ts    |   2 +-
 src/convex/mcp/tools/generate.ts   |   2 +-
 src/convex/mcp/tools/getImage.ts   |   2 +-
 src/convex/mcp/tools/listImages.ts |   2 +-
 src/convex/users.ts                |   5 +-
 src/convex/verification.ts         |   8 ++-
 src/lib/auth/providers.ts          |   7 ++
 16 files changed, 104 insertions(+), 189 deletions(-)
```

### MCP tool registration smoke

`src/convex/mcp/http.test.ts` POSTs `initialize` then `tools/list` and asserts tool **names**, in registration order:

`celstate_check_credits`, `celstate_generate`, `celstate_get_image`, `celstate_list_images`.

## 8. Highest-signal review targets

Ordered by risk, review these first:

1. **`3298a3a` (`McpToolContext` extraction)** — highest graph impact; verify the leaf module split does not break tool registration. `grep -r McpToolContext src/` should resolve imports to `./context.js` (except `handler.ts` constructing the context). Confirmed by `tools/list` smoke test on this branch.
2. **`c47c842` (pendingCheckoutId fix)** — fixes a correctness bug from the weak-types pass (`| undefined` vs schema). Confirm the schema is non-optional: `src/convex/schema.ts` (`pendingCheckoutId` on `purchaseSettlements` — line **143** at remediation time) and no caller relied on the wrong `undefined` branch.
3. **`940265f` (`ResolvedAuthProvider`)** — the `'unknown'` literal must round-trip through Convex validators. Check `src/convex/lib/ops.ts` (`authProvider` field — line **53** at remediation time) and `users.ts` call sites.
4. **`357af49` (re-export removal)** — no consumer still imports `McpToolContext` from `handler.ts`.

## 9. Expected audit deliverable

A short memo with:

- ✅ / ❌ / ⚠️ against each commit in §2.
- Any disagreement with the "not done" decisions in §4.
- Any defects or regressions discovered.
- Sign-off that the **fast audit gate** (`pnpm check`, `pnpm typecheck:tsc`, `pnpm lint:ts`, `pnpm test`) still passes on a clean checkout of the branch under review.
- (Optional) stylistic / nit comments deferred to a follow-up.

## 10. Branch + worktree artifacts still on disk

Preserved in case the auditor wants per-task blame:

- `cleanup/integration` branch — the pre-merge staging branch, identical content to `main` at merge time.
- `worktree-agent-*` branches — per-task branches. Inspect with `git log worktree-agent-<id>`.
