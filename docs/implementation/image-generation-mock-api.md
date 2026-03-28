# Image generation: mock API / fixtures — background & next steps

## Why this document exists

Repeated manual testing against the live image model (Vertex / Gemini) is **expensive** and **non-deterministic**: the same prompt can yield different pixels, retries multiply cost, and CI cannot rely on network access or billing. Once the generation pipeline (white pass → black pass → validation → matte → finalize) is **behaviorally stable**, most day-to-day work should exercise **code paths and data contracts** without paying per request.

This is complementary to “hardening” checks (`pnpm verify`, Knip, jscpd, ESLint): those catch structural drift and (via Playwright) a **browser smoke** on the marketing route; a mock/fixture layer catches **regressions in orchestration, validation, and image math** without hitting the network.

---

## Current architecture (relevant seams)

| Layer | Role | Real API? |
| --- | --- | --- |
| `src/convex/lib/gemini.ts` | `createChatSession` → `GeminiChatSession` (`sendMessage`, `sendMessageWithImages`) | Yes |
| `src/convex/generation.ts` | `generateWhiteBackground`, `generateBlackBackground`, `finalizeGeneration` actions | White/black call API; finalize uses stored images + local processing |
| `src/convex/lib/validation.ts` | Corner mean / std-dev checks for white & black backgrounds | No |
| Difference matting / PNG encode | After both backgrounds exist | No |

The **natural seam** for a mock is already sketched: `GeminiChatSession` is an interface; `createChatSession` is the only factory that talks to `@google/genai`. Swapping implementations there (or injecting a factory into the actions) avoids scattering conditionals through `generation.ts`.

---

## Goals

1. **Default dev/CI path**: run generation-related tests **without** Vertex credentials or billable calls.
2. **Optional real path**: keep a **small**, **documented** way to hit the real API (manual smoke, staging, or scheduled job).
3. **No production accidents**: mock mode must be **impossible to enable by mistake** on prod (env + deployment policy).

---

## Approaches (pick one primary strategy)

### A. Fixture-backed fake `GeminiChatSession` (recommended first step)

Implement a second factory (e.g. `createFixtureChatSession`) that returns `GeminiChatSession` whose methods resolve to **pre-generated** `GeminiImageResult` payloads (base64 + mime type) loaded from disk.

- **Pros**: Simple, fast, deterministic, works inside Convex actions (same shape as real responses).
- **Cons**: Fixtures must **pass** `validateWhiteBackground` / `validateBlackBackground` or you only test failure paths; updating fixtures when validation thresholds change is manual.

**Fixture sets to plan for:**

- Happy path: white + black images that satisfy `GENERATION_CONFIG` thresholds (`src/convex/lib/config.ts`).
- Optional: deliberately “bad” images to test **retry** and **terminal failure** without the model.

### B. Record / replay (golden traces)

Capture real `GeminiImageResult` objects (or raw API payloads) once per scenario, commit them, replay on subsequent runs.

- **Pros**: Closer to “what the API actually returned” at capture time.
- **Cons**: More tooling and storage discipline; still need refresh when prompts or model version change materially.

### C. HTTP-level mock server

Stand up a process that mimics the provider’s HTTP API.

- **Pros**: Familiar pattern for some teams.
- **Cons**: Heavy for Convex actions (extra infra, TLS, routing); your code uses the official client, not raw fetch, so you still end up stubbing at the client boundary unless you add indirection.

For this codebase, **A (fixtures + fake session)** usually gives the best cost/benefit.

---

## Convex-specific constraints

- Generation runs in **Convex actions** (`"use node"` where applicable). Any mock must run **in that environment** (Node APIs, file access if you load fixtures from the bundle — prefer embedding small base64 assets or reading from a known path at build time).
- **Environment variables** are per Convex deployment (`pnpm exec convex env set`). Mock toggles belong in **dev** only; document that prod must **not** set `*_MOCK` / `*_FIXTURE` flags.
- **Determinism**: real API outputs vary; tests should assert on **invariants** (status transitions, refund behavior, classification) and optionally on **image checksums** only when using fixed fixtures.

---

## Suggested phases

### Phase 1 — Stabilize the contract (no new infra)

- Treat `GeminiChatSession` + `GeminiImageResult` as the **only** outward dependency of the white/black stages.
- Add **unit tests** (Vitest) for `validateWhiteBackground`, `validateBlackBackground`, and failure classification (`src/lib/analytics/generation.ts`) with **synthetic pixel buffers** — no Gemini, no Convex.

### Phase 2 — Introduce a dev-only mock factory

- Add something like `createMockGeminiChatSession(scenario: 'happy' | 'white_fail' | 'black_fail')` next to `createChatSession` in `src/convex/lib/gemini.ts` (or a sibling module to keep `gemini.ts` readable).
- Branch **once** in `generation.ts` when building the session: if `process.env.GEMINI_IMAGE_MOCK === '1'` (name TBD), use the mock; else real `createChatSession`. Read env via the same pattern as `readGeminiRuntimeConfigFromEnv` for consistency.
- Document the flag in this file and in `AGENTS.md` or team runbook (single source of truth for “how to run without API”).

### Phase 3 — Fixtures and scenarios

- Commit minimal PNG-derived base64 fixtures (or generate them in a **one-off script** checked into `scripts/` that developers run after changing validation rules).
- Map each **integration** test scenario to a named fixture bundle (white stage output, black stage output).

### Phase 4 — CI split

- **PR pipeline**: `pnpm verify` (includes Vitest + Playwright E2E on marketing `/`) + tests that use mocks only (no `VERTEX_*` secrets required).
- **Optional cadence**: weekly or pre-release **manual** or **staging** run with real API to validate model drift.

### Phase 5 — Guardrails

- Assert in CI or a small script that production Convex env does not enable mock mode.
- Log clearly at action start when mock mode is active (one line, no secrets).

---

## What this does *not* replace

- **Model quality** evaluation (aesthetics, prompt adherence) still needs occasional real calls.
- **Provider SDK upgrades** (`@google/genai`) still warrant a real smoke test after bumping versions.
- **End-to-end** product tests (browser → Convex → storage) may still use mocks at the Gemini boundary while exercising everything else.

---

## Open decisions (to resolve when implementing)

1. **Fixture storage**: inline TypeScript constants vs. `*.png` under `src/convex/test/fixtures/` vs. generated at test setup time.
2. **Naming**: single env var vs. per-stage overrides (`MOCK_WHITE`, `MOCK_BLACK`).
3. **Scope of mock**: only image generation vs. also short-circuiting upload paths (usually unnecessary if fixtures are valid `GeminiImageResult` objects).

---

## Bottom line

Stopping “constant real API” testing is not about avoiding quality — it is about **moving spend and flakiness** to **rare, intentional** runs while **automation** covers the pipeline you control. The first concrete step is to **implement an alternate `GeminiChatSession` backed by committed fixtures**, toggled by an explicit dev-only environment flag, and to expand **deterministic unit tests** around validation and failure handling that already do not need the network.
