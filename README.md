# Celstate

Celstate is an AI-first pipeline for generating transparent PNG assets using dual-pass image generation and difference matting. The core library (`JobStore` + `Orchestrator`) is the canonical implementation; the API and CLI are thin adapters with zero bespoke logic.

## What It Does

- Generates a **white pass** and a **black pass** using Gemini 2.5 Flash Image.
- Uses **difference matting** to extract alpha and produce a transparent PNG.
- Produces a structured **component manifest** with layout metadata and telemetry.

## Architecture (Image Pipeline)

```
User Prompt
  -> CreativeInterpreter (Kimi-K2)
  -> White Pass (Gemini 2.5 Flash Image)
  -> Edit to Black Pass
  -> MediaProcessor (difference matting + layout analysis)
  -> Transparent PNG + Component Manifest
```

## Requirements

### Environment Variables

```
VERTEX_API_KEY=...
VERTEX_PROJECT_ID=...
VERTEX_LOCATION=...
HF_TOKEN=...
```

### Python

- Python 3.12+
- Dependencies are managed via `pyproject.toml` / `uv.lock`.

## Install

```
uv sync
```

## CLI (Internal)

Generate a transparent image:

```
celstate generate "a glowing health potion bottle" -o output.png
```

Common flags:

- `--style-context` (optional)
- `--render-size-hint` (optional, integer)
- `--layout-intent` (optional, defaults to auto)
- `--name` (optional)
- `--asset-type` (optional override)

Process existing white/black passes:

```
celstate process white.png black.png -o output.png
```

List jobs:

```
celstate jobs
```

Version:

```
celstate version
```

## API (Canonical)

The API is a thin adapter over the core library.

Run locally:

```
uvicorn src.mcp_server:app --reload
```

### POST /v1/assets

Request:

```json
{
  "prompt": "string",
  "style_context": "string",
  "asset_type": "container|icon|texture|effect|image|decoration",
  "layout_intent": "auto|row|column|...",
  "render_size_hint": 160,
  "name": "string"
}
```

Response:

```json
{
  "job_id": "uuid",
  "status": "queued"
}
```

### GET /v1/assets/{job_id}

Queued/Running:

```json
{
  "job_id": "uuid",
  "status": "processing",
  "retry_after": 10
}
```

Succeeded:

```json
{
  "job_id": "uuid",
  "status": "succeeded",
  "component": { ... }
}
```

Failed:

```json
{
  "job_id": "uuid",
  "status": "failed",
  "error": "human-readable error",
  "retry_after": 60
}
```

## Job Artifacts

Each job creates a directory under `jobs/{job_id}/`:

```
job.json
studio/     # white + black passes
outputs/    # final PNG + debug overlays/mask
trace/trace.json
```

## Testing

Run the test suite:

```
uv run pytest
```

Note: If `tests/test_analyzer.py` fails due to legacy method references, run:

```
uv run pytest --ignore=tests/test_analyzer.py
```

## Reference

- Canonical contract: `docs/interface_contract.md`
- Project plan: `update_plan.md`
