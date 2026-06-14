# Animation Worker

Celstate animation requests are stored in Convex, but media processing runs in a
Node worker because FFmpeg and video alpha QA do not belong in Convex serverless
actions.

Design rationale (difference matte → RGBA still → deterministic frames → runtime bundle):
[Living-UI animation spike](../product/LIVING-UI-ANIMATION-SPIKE.html).

## Current Pipeline

```text
/app/animations request
  -> animationGenerations row with status intake
  -> media worker claims one intake row
  -> Vertex/Gemini transparent still generation via white/black difference matte
  -> deterministic RGBA frame animation
  -> 12-cell sprite sheet + runtime manifest
  -> FFmpeg transparent preview/compatibility exports
  -> decode-and-verify alpha QA
  -> Convex storage upload
  -> animationGenerations complete
```

The worker writes these user-facing artifacts:

- transparent WebM VP9 alpha for OBS and Chromium playback
- ProRes 4444 MOV for editor workflows
- APNG for lightweight preview/loop use
- PNG and WebP-alpha sprite sheets for runtime consumption
- PNG frame-sequence ZIP
- living UI runtime manifest JSON

WebM verification must force `libvpx-vp9` decode. Native FFmpeg VP9 decode can
drop alpha even when the file contains `ALPHA_MODE=1`.

## Required Environment

Set these in the worker environment:

```pwsh
$env:PUBLIC_CONVEX_URL="https://<deployment>.convex.cloud"
$env:ANIMATION_WORKER_SECRET="<same value configured in Convex>"
$env:VERTEX_AI_PROJECT_ID="celstate-489304"
$env:VERTEX_AI_LOCATION="global"
$env:VERTEX_AI_SERVICE_ACCOUNT_JSON="<service account json from Doppler>"
```

Set `ANIMATION_WORKER_SECRET` in Doppler and sync it to Convex:

```pwsh
doppler secrets set ANIMATION_WORKER_SECRET="<random long secret>" --project=celstate --config=dev
pnpm secrets:sync:convex:dev
```

Use the `prd` config and `pnpm secrets:sync:convex` for production. Do not use
`convex env list`.

The worker host must have `ffmpeg` and `ffprobe` on `PATH`. The current local
smoke was verified with FFmpeg 8.1.1.

## Running

Process one ready animation and exit:

```pwsh
pnpm animation-worker:once
```

When reading secrets from Doppler locally:

```pwsh
doppler run --project=celstate --config=dev -- pnpm animation-worker:once
```

Poll continuously:

```pwsh
pnpm animation-worker
```

Keep per-job working files for inspection:

```pwsh
pnpm animation-worker:once -- --keep-workdir --workdir tmp/animation-worker
```

Transient Vertex/network errors (HTTP 429, connect timeouts) requeue the same
`animationGenerations` row back to `intake` up to `maxWorkerRetries` (3) instead
of failing immediately. That preserves the job identity and avoids paying for a
brand-new row on a rate-limit blip. Permanent failure still refunds charged
credits when `creditsPerAnimationRequest` is non-zero.

Summarize a retained job workdir:

```pwsh
pnpm animation-worker:report -- --workdir tmp/animation-worker/<animationGenerationId>
```

## Runtime Package

The worker's `manifest.json` is consumed by
`@celstate/living-ui-runtime` in `packages/living-ui-runtime`.

Use this gate before publishing manifest-shape or sprite-sheet changes:

```pwsh
pnpm build:living-ui-runtime
pnpm exec vitest run packages/living-ui-runtime/src/index.test.ts
```

The package has two entrypoints:

- `@celstate/living-ui-runtime` validates manifests and provides pure sprite
  sheet math for frame selection, atlas offsets, export selection, and
  right-size checks.
- `@celstate/living-ui-runtime/react-native` renders Tier 1 PNG/WebP sprite
  sheets with `Image` + Reanimated frame callbacks. It is the reference
  component path for C-gate device testing on iOS and Android.

Treat the package and worker manifest as one contract. If the worker changes
`pipeline`, `spriteSheet`, `runtime`, `exports.spriteSheetPng`, or
`exports.spriteSheetWebp`, update the package types and tests in the same
change.

## MVP Evidence Evaluation

Use `evaluateLivingUiMvp` from the runtime package, or the repo CLI wrapper, to
turn retained generation/device-study evidence into a strict pass/fail result:

```pwsh
pnpm living-ui:evaluate-mvp -- path/to/evidence.json
```

The evaluator checks the spike's G-gate, C-gate, coverage bar, aliveness 2AFC,
and calibrated constants. It exits with code `1` until at least four of the five
in-scope classes pass both gates through a runtime component on iOS and Android,
the aliveness test clears 70/30 at `p < 0.05`, and the calibration sample pins
`B_max`, `epsilon_loop`, and `N_min`.

## Flight Recorder

When `--keep-workdir` or `--workdir` is used, each claimed job directory keeps
diagnostic artifacts so paid QA runs can be debugged after the fact:

- `job.json` - claimed worker payload
- `events.ndjson` - timestamped worker stage events
- `initial-white-reference.png` / `initial-black-reference.png`
- `initial-white-validation.json` / `initial-black-validation.json`
- `initial-matte-reference.png` / `initial-qa-reference.json`
- `retry-plan.json` plus `retry-*` artifacts when transparent QA asks for a retry
- `reference.png` / `reference-qa.json` for the accepted transparent still
- `export-qa.json`, `manifest.json`, sprite sheets, and exported media on completed jobs
- `failure.json` when the worker closes a job as failed

## Scope

This worker ships the MVP production path for living UI assets: generated
transparent still assets animated into runtime-ready sprite sheets, manifests,
and compatibility previews. It does not yet implement multi-cell generated
sprite-sheet coherence measurement or an opaque Veo video alpha reconstruction
adapter. Those remain separate spike workstreams.

The code path is necessary but not sufficient for the spike's MVP bar. Before
declaring MVP complete, the retained job artifacts must show at least four of
the five in-scope living UI classes passing the spike's G-gate and C-gate, with
the same assets rendering through the runtime on physical iOS and Android
devices. The aliveness 2AFC and calibrated constants (`B_max`, `epsilon_loop`,
and `N_min`) are product-measurement requirements, not unit-test requirements.
