# DiffDIS Vendoring Audit

**Date:** 2026-01-16
**Scope:** `src/celstate/vendor/DiffDIS`

## Summary
Vendored DiffDIS core + utils + `diffusers-0.30.2` fork. Audited for hardcoded paths, non-relative imports, and device assumptions. Applied targeted fixes for runtime safety in inference paths.

## Findings & Fixes

### 1) Hardcoded dataset paths
- **Found:** `utils/config.py` contained `/home/...` absolute paths.
- **Fix:** Replaced with `DIFFDIS_DIS_DATA_ROOT` env var and a relative default under `vendor/DiffDIS/data/DIS5K`.

### 2) Non-relative imports in core
- **Found:** `core/diffdis_pipeline.py` imported `utils.depth_ensemble` as a top-level package.
- **Fix:** Switched to relative import `from ..utils.depth_ensemble import ensemble`.

### 3) Script import safety
- **Found:** `run_inference.py` relied on non-relative imports for local modules.
- **Fix:** Added a `try/except ImportError` block to prefer relative imports when used as a package, with fallback for standalone script use.

### 4) Device assumptions / hardcoded CUDA
- **Found:**
  - `core/diffdis_pipeline.py` used `.cuda()` for scheduler alphas and discriminative labels.
  - `diffusers/models/unets/unet_2d_condition_diffdis.py` hardcoded CUDA in `HighPassFilter`.
  - `utils/utils.py` used `.cuda()` in `generate_multi_scale_latents`.
- **Fix:** Switched to `device`-aware logic, using input tensor device and `torch.cuda.is_available()` checks where appropriate.

### 5) Diffusers fork
- **Found:** Vendored `diffusers-0.30.2` includes `UNet2DConditionModel_diffdis` and other modifications; `__version__` reports `0.27.2`.
- **Action:** Treat as a forked diffusers implementation and load via vendored path in the wrapper (see `DiffDISWrapper`).

## Non-blocking Notes
- `/home/...` and `sys.path` references exist in diffusers examples/tests/scripts only; not used in runtime inference.
- `__pycache__` and `.pyc` artifacts are present in vendor folders; consider removing before release if needed.

## Updated Files
- `src/celstate/vendor/DiffDIS/utils/config.py`
- `src/celstate/vendor/DiffDIS/core/diffdis_pipeline.py`
- `src/celstate/vendor/DiffDIS/utils/utils.py`
- `src/celstate/vendor/DiffDIS/utils/dataset_strategy.py`
- `src/celstate/vendor/DiffDIS/run_inference.py`
- `src/celstate/vendor/DiffDIS/diffusers-0.30.2/src/diffusers/models/unets/unet_2d_condition_diffdis.py`
- `src/celstate/vendor/DiffDIS/__init__.py`

## Next Step
Wire `DiffDISWrapper` into Celstate’s background removal flow (Phase 3).
