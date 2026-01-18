# Celstate Canonical Schema and Interface Contracts (v1)

## 1. Goals

- Core library (JobStore + Orchestrator) is the canonical implementation.
- API is the canonical public interface and a thin adapter over the core.
- CLI, if kept, is internal-only and must remain a thin wrapper with zero bespoke logic.
- Strict failure with structured errors; no raw exceptions or partial success.
- Minimized output for agents; avoid exposing internal asset types in the external API.

## 2. Canonical JobRecord.v1 (jobs/{job_id}/job.json)

This is the single source of truth for job state. It is written by `JobStore` and updated by `Orchestrator`.

### 2.1 Required Fields

```
{
  "id": "uuid",
  "status": "queued|running|succeeded|failed",
  "type": "container|icon|texture|effect|image|decoration",
  "layout_intent": "auto|row|column|...",
  "prompt": "string",
  "style_context": "string",
  "name": "string",
  "created_at": "ISO-8601 UTC",
  "updated_at": "ISO-8601 UTC",
  "progress_stage": "initialized|generating|generating_image|processing_background_removal|verifying_container|completed|error",
  "component": { ... } | null,
  "error": "string" | null
}
```

### 2.2 Optional Fields

```
{
  "render_size_hint": 160,
  "retry_after": 60
}
```

### 2.3 Field Notes

- `type` is the internal asset type stored in the job record. It is **not exposed** by the external API.
- `layout_intent` is stored for layout-aware downstream use. It is currently persisted but not enforced in the pipeline.
- `progress_stage` is a fine-grained internal state used for diagnostics.
- `component` is populated after successful processing.
- `retry_after` is populated only on rate-limit failures.

## 3. Component Manifest (job.component)

`MediaProcessor` produces a component object with a structured manifest and assets map.

```
{
  "manifest": {
    "version": "0.1",
    "id": "asset_name",
    "type": "static",
    "intrinsics": {
      "size": {"width": 512, "height": 256},
      "anchor": {"x": 0.5, "y": 0.5},
      "content_zones": { ... },
      "slice_insets": { ... },
      "shape_hint": { ... },
      "safe_zone": { ... },
      "layout_bounds": { ... },
      "mask_asset": "asset_mask.png" | null,
      "snippets": { ... }
    },
    "states": {
      "idle": {"clip": "asset.png", "loop": false}
    },
    "transitions": [],
    "accessibility": {"role": "image", "label": "Asset Name"}
  },
  "assets": {
    "asset.png": null,
    "asset_mask.png": null,
    "asset_debug.png": null
  },
  "telemetry": { ... }
}
```

Notes:
- `assets` values are `null` placeholders for URL injection at the API layer.
- `telemetry` includes transparency analysis output.

## 4. JobCreateRequest.v1 (API Input)

This is the canonical creation payload for the API (and any internal CLI wrapper).

```
{
  "prompt": "string (1-2000 chars)",
  "style_context": "string",
  "asset_type": "container|icon|texture|effect|image|decoration" | null,
  "layout_intent": "auto|row|column|..." | null,
  "render_size_hint": 160 | null,
  "name": "string" | null
}
```

Validation:
- `prompt` length must be <= 2000 characters.
- `asset_type` must be in the allowed set if provided; otherwise the system infers it from the prompt.
- `render_size_hint` must be an integer if provided.

## 5. API Contract (Canonical Public Interface)

The API is the canonical public interface and must be a thin adapter over `JobStore` and `Orchestrator`. No business logic beyond validation and response shaping.

### 5.1 POST /v1/assets

**Request**: `JobCreateRequest.v1`

**Response**

```
{
  "job_id": "uuid",
  "status": "queued"
}
```

Notes:
- API must **not** echo internal `asset_type` in responses.
- If `asset_type` is omitted, infer from prompt.
- Orchestrator should run asynchronously (background thread) to avoid blocking.

### 5.2 POST /v1/assets/remove-bg

Accepts a single image upload for background removal.

**Request (multipart/form-data)**

- `file` (required): image upload
- `asset_type` (optional): `container|icon|texture|effect|image|decoration`
- `layout_intent` (optional): `auto|row|column|...`
- `name` (optional): asset name

**Response**

```
{
  "job_id": "uuid",
  "status": "queued"
}
```

### 5.3 GET /v1/assets/{job_id}

**Queued/Running**

```
{
  "job_id": "uuid",
  "status": "processing",
  "retry_after": 10
}
```

**Succeeded**

```
{
  "job_id": "uuid",
  "status": "succeeded",
  "component": { ... }
}
```

**Failed**

```
{
  "job_id": "uuid",
  "status": "failed",
  "error": "human-readable error",
  "retry_after": 60
}
```

### 5.4 Error Envelope (Validation/Bad Input)

```
{
  "error": "Validation Failed",
  "details": "prompt exceeds 2000 characters"
}
```

## 6. Internal CLI (Optional; Dev/Test Only)

If a CLI is kept, it is internal-only and must remain a thin wrapper over the core library with zero bespoke logic. It is not part of the public contract.

### 6.1 `celstate generate` (internal)

- Accepts: `prompt`, `--output`, `--style-context`, `--render-size-hint`, `--layout-intent`, `--name`, `--asset-type` (optional), `--seed` (ignored).
- Must call `JobStore.create_job()` then `Orchestrator.run_job()` and copy output to `--output`.
- Success output schema: `{status, job_id, output_path, dimensions, transparency, generation_time_ms}`.
- Error output schema: `{status: "error", code, message, retry_after_seconds?, suggestion?}`.

### 6.2 `celstate process` (internal)

- Input: `white_path`, `black_path`, `--output`
- Output: `{status, output_path, dimensions, generation_time_ms}`

### 6.3 `celstate jobs` / `celstate version` (internal)

- Jobs output: `{jobs: [JobRecord.v1], total: n}`
- Version output: `{version: "x.y.z"}`

## 7. Observability and Artifacts

- `jobs/{job_id}/studio/`: white and black passes
- `jobs/{job_id}/outputs/`: final PNG + debug overlays/mask
- `jobs/{job_id}/trace/trace.json`: structured trace events

These artifacts are stored on disk and are not exposed by the external API.
