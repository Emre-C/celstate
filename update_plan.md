# Celstate CLI Modernization Plan

**Status:** Phase 1 & 2 Complete · Phase 3 Blocked (Video Pipeline)  
**Goal:** CLI for generating transparent images/videos via Vertex AI

---

## Quick Reference

### APIs & Models

| Component | Model ID | Docs |
|-----------|----------|------|
| Image Gen | `gemini-2.5-flash-image` | [Nano Banana](https://ai.google.dev/gemini-api/docs/image-generation) |
| Video Gen | See "Video Pipeline Options" below | — |
| Interpreter | `moonshotai/Kimi-K2-Instruct-0905:groq` | [HF Router](https://huggingface.co/docs/inference-providers) |

### Required Environment Variables

```bash
VERTEX_API_KEY=...
VERTEX_PROJECT_ID=...
VERTEX_LOCATION=...
HF_TOKEN=...  # For interpreter
```

### Commands

```bash
celstate generate "prompt" -o output.png   # Generate transparent image
uv run pytest --ignore=tests/test_analyzer.py  # Run tests
```

---

## Architecture

```
User Prompt → Interpreter (Kimi-K2) → Dual-Pass Generation → Diff Matting → Transparent Output
```

**Image Pipeline (Working):**
1. Interpreter adds transparency constraints to prompt
2. Generate white-background image
3. Edit white image → black-background variant  
4. Difference matte → extract alpha

---

## Current State

### ✅ Phase 1 & 2 Complete

- CLI outputs structured JSON (AI-agent optimized)
- Interpreter stripped of aesthetic bias—only adds transparency constraints
- Asset type inferred from keywords (`frame` → container, `button` → icon)
- Auto-verifies hollow center for containers (≥15% transparency)

### 🔴 Known Issues

| Issue | Status | Notes |
|-------|--------|-------|
| No post-generation QA | **Phase 4** | Black pass can silently fail, producing garbage 99% transparency |
| `test_analyzer.py` outdated | Skip | References removed methods; needs rewrite or deletion |

---

## Phase 3: Video Pipeline

### ⚠️ CRITICAL: Dual-Pass Veo DOES NOT WORK

Previous experiments (documented in `archive/implementation_plan.md`) conclusively proved:

| Approach | Result | Details |
|----------|--------|---------|
| Dual-pass Veo with seed | **FAILED** | Motion paths differ even with identical seeds. Internal motion (pulsing, rotation) diverges between white/black passes. |
| Dual-pass Veo with `last_frame` | **FAILED** | `last_frame` parameter rejected on Gemini API tier with "use case not supported". May require Enterprise Vertex AI. |
| Reference images for consistency | **FAILED** | `reference_images` parameter doesn't lock motion, only rough appearance. |

**Root cause:** Video diffusion models are fundamentally non-deterministic. Seeds provide partial guidance but cannot guarantee frame-by-frame motion alignment required for difference matting.

### Viable Alternatives

| Option | Status | Pros | Cons |
|--------|--------|------|------|
| **RunComfy + Wan 2.1** | ✅ Proven | Native transparent output, no matting needed | External dependency, requires `RUNCOMFY_API_TOKEN` |
| **Neural Matting (RVM)** | Untested | Single video pass, ML-based alpha extraction | Requires PyTorch, may struggle with soft edges |
| **Chroma Key** | Fallback | Simple FFmpeg pipeline | Lossy alpha, green halo artifacts |

### RunComfy Details (Recommended Path)

The Wan 2.1 model via RunComfy API produces **native transparent PNG frames**:

```python
url = 'https://api.runcomfy.net/prod/v1/deployments/{deployment_id}/inference'
payload = {
    'overrides': {
        "6": {"inputs": {"text": "A glowing orb. The background of this video is transparent."}}
    }
}
# Returns: ZIP of transparent PNG frames
```

**Verified working** — see `archive/video_frames/runcomfy_output.webp` for proof.

**Limitations:**
- Default 33 frames (~2 sec at 16fps), can override to 81 frames
- 1280x720 resolution
- T2V only (no state machine consistency across variations)

### If You Must Use Veo

For simple, non-looping animations where slight motion drift is acceptable:
1. Generate single video on green/blue background
2. Use FFmpeg chroma key: `ffmpeg -i input.mp4 -vf "chromakey=0x00ff00:0.1:0.2" output.webp`
3. Accept imperfect edges

---

## Phase 4: Hardening

### Post-Generation QA (Critical)

The edit-based black pass can fail silently. Required validations:

| Check | Threshold | Error Code |
|-------|-----------|------------|
| Black pass corners | brightness < 30 | `BLACK_PASS_FAILED` |
| Pass subject match | SSIM > 0.95 | `PASS_ALIGNMENT_FAILED` |
| Output transparency | warn if > 98% | `SUSPICIOUS_TRANSPARENCY` |

### Error Codes

| Code | Agent Action |
|------|--------------|
| `SUCCESS` | Use output |
| `RATE_LIMITED` | Wait `retry_after_seconds`, retry |
| `HOLLOW_CENTER_MISSING` | Add "with hollow center" to prompt |
| `BLACK_PASS_FAILED` | Retry |
| `AUTH_ERROR` | Check env vars |

---

## Notes for AI Implementers

1. **Research first**: Always `web_search` API docs before implementing
2. **Read signatures**: Function signatures have changed—verify before calling
3. **Test incrementally**: Verify each component works before integration
4. **Vertex AI mode**: Uses `genai.Client(vertexai=True)`, NOT Gemini API keys
5. **No edit mode for video**: Unlike images, Veo cannot edit existing video
6. **Dual-pass video is dead**: Do not attempt. See experiments in `archive/implementation_plan.md`

---

## Key Archive Documents

| File | Purpose |
|------|---------|
| `archive/implementation_plan.md` | Full experiment history for video approaches (failures documented) |
| `archive/research.md` | Video matting techniques, RVM research |
| `archive/video_frames/runcomfy_output.webp` | Proof that RunComfy produces transparent video |

---

## References

- [Veo API](https://ai.google.dev/gemini-api/docs/video)
- [Nano Banana](https://ai.google.dev/gemini-api/docs/image-generation)
- [HF Inference Providers](https://huggingface.co/docs/inference-providers)
- [RunComfy API](https://docs.runcomfy.com/)
- [Robust Video Matting](https://github.com/PeterL1n/RobustVideoMatting)
