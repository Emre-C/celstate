# Animation Worker

Celstate animation requests are stored in Convex, but media processing runs in a
Node worker because FFmpeg and video alpha QA do not belong in Convex serverless
actions.

Design rationale (difference matte → RGBA still → deterministic frames → encode):
[Transparent animation generation](../implementation/TRANSPARENT-ANIMATION-GENERATION.md).

## Current Pipeline

```text
/app/animations request
  -> animationGenerations row with status intake
  -> media worker claims one intake row
  -> Vertex/Gemini transparent still generation via white/black difference matte
  -> deterministic RGBA frame animation
  -> FFmpeg transparent exports
  -> decode-and-verify alpha QA
  -> Convex storage upload
  -> animationGenerations complete
```

The worker writes these user-facing artifacts:

- transparent WebM VP9 alpha for OBS and Chromium playback
- ProRes 4444 MOV for editor workflows
- APNG for lightweight preview/loop use
- PNG frame-sequence ZIP
- canonical frame manifest JSON

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

Summarize a retained job workdir:

```pwsh
pnpm animation-worker:report -- --workdir tmp/animation-worker/<animationGenerationId>
```

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
- `export-qa.json`, `manifest.json`, and exported media on completed jobs
- `failure.json` when the worker closes a job as failed

## Scope

This worker ships a high-confidence first production path: generated transparent
still assets animated into real RGBA video exports. It does not yet implement
opaque Veo video alpha reconstruction. That remains a separate media model
adapter once representative Veo clips and a matting stack/provider have been
validated.
