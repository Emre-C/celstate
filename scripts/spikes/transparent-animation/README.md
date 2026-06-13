# Transparent Animation Spike Module Map

The public entrypoint stays at `scripts/spikes/transparent-animation-spike.ts`.
Use this map to load only the context needed for a spike iteration.

## Always start here

- `../transparent-animation-spike.ts` — command registry, provider flow, stage recipes, scoring, and reporting.
- `model.ts` — shared constants and data contracts for runs, stages, scores, and provider calls.

## Load by task

- CLI option parsing: `args.ts`, then the target command in `../transparent-animation-spike.ts`.
- Run durability, events, command logs, ffmpeg/ffprobe execution: `harness.ts`.
- FFmpeg chroma/despill graph changes: `ffmpeg-filters.ts`, then the calling stage in `../transparent-animation-spike.ts`.
- Frame extraction and raw image I/O: `media.ts`.
- Compiler math, v6/v7 alpha projection, and synthetic eval contracts: `../alpha-compiler/core.ts`, `../alpha-compiler/metrics.ts`, and `../alpha-compiler/eval-cli.ts`.
- Provider prompting or Veo/Gemini request flow: provider prompt helpers and `providerGenerateSource` in `../transparent-animation-spike.ts`.

## Split policy

Keep new modules shallow and purpose-specific. Stage experiments should stay readable as whole recipes unless a piece becomes reusable, deterministic, and testable enough to move into `../alpha-compiler/`.
