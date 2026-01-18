# DiffDIS Plan — Agent 1 (Integration)

**Owner:** Agent 1 (Core integration + API/CLI wiring)  
**Goal:** Replace dual-pass difference matting with DiffDIS single-image background removal.  
**Scope:** Engine + pipeline integration only.  
**Do NOT edit:** `docs/diffDIS_plan_agent2_verification.md`, any verification/benchmark docs or scripts.

---

## ✅ Completed Context (Phase 1–2)
- Dependencies added in `pyproject.toml` (torch/torchvision/diffusers/transformers/einops/scikit-image/scipy).
- Vendored DiffDIS repo at `src/celstate/vendor/DiffDIS` (including `diffusers-0.30.2`).
- Wrapper created: `DiffDISWrapper` in `src/celstate/vendor/DiffDIS/__init__.py`.
- Audit & fixes recorded in `docs/diffDIS_audit.md`.
- Model ID to load: `qianyu1217/diffdis`.

Relevant files:
- Wrapper: `src/celstate/vendor/DiffDIS/__init__.py`
- Pipeline: `src/celstate/vendor/DiffDIS/core/diffdis_pipeline.py`
- Audit: `docs/diffDIS_audit.md`

---

## ✅ Integration Goals (Phase 3)

### 1) Add background removal engine
- **Create:** `src/celstate/engine/background_remover.py`
- **Implement:** `DiffDISModel` that wraps `DiffDISWrapper`.
- **API shape (suggested):**
  - `load_weights()`
  - `predict(image: PIL.Image) -> PIL.Image` (return RGBA with alpha)
  - Optional: `predict_mask(image) -> PIL.Image` for debug

**Important:** `DiffDISWrapper.predict()` returns `(mask_tensor, edge_tensor)` on CPU. Convert mask into alpha and apply to the original image.

### 2) Replace difference matting pipeline
- **Target files:**
  - `src/celstate/processor.py` (MediaProcessor)
  - `src/celstate/orchestrator.py`

**Strategy:**
- Introduce a single-image background removal method (e.g., `process_input_image`) that uses `DiffDISModel`.
- Preserve the return shape used by `Orchestrator` (e.g., `{name, component, telemetry}`).
- Keep LayoutAnalyzer integration (it currently consumes RGBA output).

### 3) CLI + API wiring
- **CLI:** `src/celstate/cli/main.py`
  - Add new command (e.g., `remove-bg`) **or** extend `process` to accept a single image.
- **API:** `src/mcp_server.py`
  - Add endpoint or extend existing one to accept an input image and run DiffDIS.

---

## Integration Constraints / Non-Goals
- **Do not touch verification or benchmark files.** Agent 2 handles that.
- **Do not attempt dual-pass video.** (Per `update_plan.md`, video path is dead.)
- **Avoid changing vendored DiffDIS unless strictly necessary.**

---

## Implementation Notes
- `DiffDISWrapper` handles vendored diffusers path injection.
- Device selection is handled in wrapper, but you can pass `device="mps"` or `"cuda"` explicitly if needed.
- The DiffDIS pipeline expects input tensors normalized to `[-1, 1]` and resized. Wrapper already handles normalization and resizing.

---

## Suggested Step Order
1. Build `DiffDISModel` in `engine/background_remover.py`.
2. Add a single-image flow in `MediaProcessor` (mirror the old `process_image` return format).
3. Update `Orchestrator` to call DiffDIS path.
4. Wire CLI and FastAPI to invoke the new flow.

---

## Exit Criteria
- Single-image input path produces RGBA output with alpha from DiffDIS mask.
- Orchestrator can run a job without white/black pair inputs.
- CLI and API can trigger DiffDIS background removal end-to-end.
