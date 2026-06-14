# Archived — Transparent-Animation R&D (video-source + alpha-matting line)

**Status: frozen.** This directory is kept for reference only. It is *intentionally
disconnected* from the app and the build: it sits outside the `tsconfig` include
globs, the ESLint `files` globs (and is explicitly ignored), the Vitest
`test.include`, and the Knip project globs. Nothing in `src/`, `scripts/`, or
`packages/` imports it, and it is not run by `pnpm verify`.

## Why it's here

This is the original R&D line that generated an **opaque source video** (Veo) and
recovered alpha via temporal matting (MatAnyone2 / chroma / despill) and the
synthetic-ground-truth **alpha compiler**. We pivoted away from it. The full
record of *why* lives in
[`docs/archive/transparent-animation/TRANSPARENT-ANIMATION-RD-SPIKE.md`](../../docs/archive/transparent-animation/TRANSPARENT-ANIMATION-RD-SPIKE.md).

The active successor is the sprite-driven Living-UI direction:
[`docs/product/LIVING-UI-ANIMATION-SPIKE.html`](../../docs/product/LIVING-UI-ANIMATION-SPIKE.html).
It reuses the *difference-matting image pipeline* (`src/convex/lib/generation/matte.ts`),
not this video line.

## Contents

- `transparent-animation-spike.ts` — the spike entrypoint: command registry,
  provider flow (Veo/Gemini), stage recipes, scoring, reporting.
- `transparent-animation/` — supporting modules (CLI args, ffmpeg chroma/despill
  filters, run harness, frame media I/O, data contracts). See its `README.md`
  for the module map.
- `alpha-compiler/` — pure numerical alpha-projection core + synthetic
  ground-truth eval (`core.ts`, `metrics.ts`, `truth.ts`, `baseline.ts`,
  `eval-cli.ts`, committed `baselines/`).
- `matanyone2.ps1` — WSL helper for running MatAnyone2.

## Reviving it later

These files still import the live `src/convex/lib/gemini.js` helper (one import in
the spike entrypoint); relative paths were preserved on archival, so the imports
resolve as-is. To run them again, re-add the former package.json scripts (or
invoke `tsx` directly):

```jsonc
"transparent-animation-spike": "tsx archive/transparent-animation/transparent-animation-spike.ts",
"alpha-eval": "tsx archive/transparent-animation/alpha-compiler/eval-cli.ts"
```

Before relying on them, re-include the directory in `tsconfig`/ESLint/Vitest so it
typechecks against the current `src/` again.
