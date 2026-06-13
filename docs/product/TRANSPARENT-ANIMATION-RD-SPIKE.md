# Transparent Animation R&D Spike

> **Readable brief:** [TRANSPARENT-ANIMATION-RD-SPIKE.html](./TRANSPARENT-ANIMATION-RD-SPIKE.html) — consolidated operating view (June 2026). Use the HTML for day-to-day iteration; this Markdown retains full chronological history.

> **Status:** current source of truth for transparent-animation R&D.
> **Intent:** keep the durable context, shipped spike artifacts, known failures, and next exploration paths. This document is not a product spec or production worker plan.

---

## 1. Background Context

Celstate already creates transparent still assets: logos, icons, characters, stickers, and overlays. The animation opportunity is the same promise with motion: short transparent assets that creators can drop directly into OBS, editors, social video, and websites without rotoscoping, chroma-key cleanup, or manual compositing.

Transparent generative video remains hard because alpha is not directly recoverable from arbitrary RGB video. A final RGB pixel does not tell us the original foreground color and opacity. Even with chroma backgrounds, generated video introduces compression shifts, green spill, motion blur, fine hair/fur edges, particles, and foreground colors close to the key color.

The durable thesis is still the **Celstate Alpha Compiler**:

```text
generated RGB/native-RGBA/chroma video
  + prompt/reference context
  + rough matte or native alpha
  + temporal signals
  -> refined foreground RGB
  -> stable alpha video
  -> confidence/artifact report
  -> WebM / ProRes MOV / APNG / still exports
```

This layer matters because individual upstream video models will keep changing. A proprietary transparent-video production layer remains useful whether the source is Veo, Runway, Kling, Sora, Wan-Alpha, a future native-RGBA model, or a third-party matting API.

---

## 2. Current R&D Verdict

We are **not blocked on video generation** for the flagship wedge. Existing generated videos are good enough for transparency R&D. Do not generate new provider videos unless a local alpha experiment proves the current sources cannot answer the question.

The Alpha Compiler thesis is now **credible on the flagship clip**. Matte quality, detached-element recovery, and foreground RGB repair are no longer the primary blocker for that source:

- MatAnyone2 temporal prior + chroma detached-element fusion is the right architecture;
- projection decontamination (v6) replaced channel-clamp despill and reconstructs mixed fringe RGB instead of desaturating it;
- color-line alpha fusion + matting-equation recovery (v7) further improves detached recall, soft-alpha preservation, and fine-strand fidelity on synthetic truth;
- detached-element interiors preserve source color exactly; edge bands only are repaired;
- WebM / ProRes / APNG exports still verify correctly.

The current promoted review artifact is under:

```text
tmp/transparent-animation-spike/review/test3-trim1-sampled-green-s20/
  transparent-still.png
  transparent-still-on-cream.png
  transparent-still-on-red.png
  transparent-still-on-texture.png
  transparent-animation.webm
  transparent-animation-prores.mov
  animation-on-cream-preview.mp4
  spill-heatmap.png
  report.json
```

Source:

```text
tmp/transparent-animation-spike/runs/test3-trim1-sampled-green-s20/source.mp4
```

Stage that produced the promotion:

```text
tmp/transparent-animation-spike/runs/test3-trim1-sampled-green-s20/celstate-alpha-v7/
```

Verification from the promoted review candidate:

- `transparent-still.png` is RGBA, 1280x720.
- `transparent-animation.webm` is VP9 WebM with `alpha_mode=1`, 1280x720, 9 seconds.
- `transparent-animation-prores.mov` is ProRes with alpha (`yuva444p12le`), 1280x720, 216 frames.
- `report.json` includes residual spill, detached-color fidelity, temporal-alpha delta, and projected-coverage metrics plus `spill-heatmap.png`.

**Real-prior leg (2026-06-12):** the BRIA leg ran on synthetic truth (`pnpm alpha-eval run --prior bria`, section 3.15). v7 beat v6 on every target metric under the identical real prior, so the v7 mechanisms are not artifacts of the simulated prior — production-worker design for subject + detached content is unblocked. Genuine soft alpha (smoke) proved **prior-bound** with a segmentation-class prior: BRIA binarizes it and the compiler recovers only part. **Next blocker:** MatAnyone2 leg (`--prior dir`, CUDA box) to decide the soft-content stance; then generalization beyond the three synthetic scenarios (different key colors, soft alpha, non-mascot content).

**Phase 1 (2026-06) shipped:** v7 core mechanisms (color-line alpha fusion, matting-equation foreground recovery, evidence-gated detached path) moved all target metrics on synthetic truth and updated the baseline. Quality is now measurable, reproducible, and regression-checkable via the synthetic ground-truth eval (`pnpm alpha-eval run` / `compare`, section 3.14) with a committed baseline and unit-tested numerical core.

Historical baselines remain useful for comparison:

- `celstate-alpha-v4-prior-fusion/` — first strong per-frame BRIA prior; visible green rim.
- `celstate-alpha-v5-video-prior/` — MatAnyone2 subject matte + clamp/pull despill; better edges, residual leaf desaturation and tail tinge.
- `celstate-alpha-v6-projection/` — projection decontamination; flagship promoted, synthetic truth gaps remain.
- `celstate-alpha-v3-core-fringe/` — negative; chroma-equation fringe recovery created ghost doubles.

---

## 3. What We Have Done So Far

### 3.1 Built the local spike harness

The local harness lives at:

```text
scripts/spikes/transparent-animation-spike.ts
```

It can:

- create and track runs under `tmp/transparent-animation-spike/runs/<run-id>/`;
- store `input.json`, `events.ndjson`, `pipeline-state.json`, logs, source video, previews, and stage reports;
- generate provider first/last frames and source video when needed;
- reuse existing source videos for local alpha experiments;
- run local alpha stages;
- export WebM, ProRes MOV, APNG, alpha diagnostics, and still frames;
- score outputs manually.

### 3.2 Proved image-anchored source generation is viable

Prompt-only chroma video attempts tended to turn the requested flat background into a studio backdrop or floor gradient.

Image-anchored generation performed better. Existing runs show that a mascot can preserve useful identity, pose, and secondary leaf motion over a chroma-ish background. The flagship source clip is good enough to keep using for local alpha experiments.

### 3.3 Established commodity chroma key baselines

The early `celstate-alpha-v0` path used FFmpeg `colorkey` plus a small temporal alpha smoother. It produced alpha video, but left obvious green spill and edge halos around fur, leaves, and motion-blurred regions.

This validated the first important lesson: **single-color keying is a useful experimental input, not exact alpha recovery.**

### 3.4 Added key-first despill

The corrected `celstate-alpha-v1-despill` approach is:

```text
source.mp4
  -> colorkey
  -> alphaextract
  -> temporal alpha smoothing
  -> despill keyed RGB while preserving alpha
  -> alphamerge
```

Important finding: despill must run **after** keying in this harness. Despill-before-key suppresses the green plate enough that `colorkey` can fail to detect the background.

### 3.5 Confirmed global loose keying damages foreground

On `test1-sampled-green-s18`, loosening `similarity` to `0.5` produced real transparency, but it also made parts of the mascot, jacket, fur, face, leaves, and motion-blurred foreground partially transparent.

Root cause: `colorkey` uses one global RGB distance radius. A radius broad enough to catch compressed background variations also catches green-adjacent foreground pixels.

Conclusion: **do not solve this by only sweeping `similarity` or `despill-mix`.** Smaller output size is not quality proof; it may mean foreground was deleted.

### 3.6 Produced a reviewable transparent still and animation

The current best review candidate uses the existing `v1-despill-mask` artifact from `test3-trim1-sampled-green-s20`. It is not perfect, but it is no longer obviously broken:

- alpha exists;
- subject interior is mostly preserved;
- motion reads well over a light background;
- green outline remains visible, especially on red and around edge detail.

### 3.7 Tried an initial `v2-trimap` path

A first `celstate-alpha-v2-trimap` implementation was added and run. It attempted temporal background-plate estimation and border-connected background removal.

Result: not yet better than `v1-despill-mask`. The estimated background plate was contaminated by moving foreground, leaving green residue around the subject. The direction is still promising, but the implementation needs stronger foreground exclusion and a better core/fringe model.

### 3.8 Ran `v3-core-fringe` edge-only RGB repair

A `celstate-alpha-v3-core-fringe` stage was added to the spike harness and run on the existing `test3-trim1-sampled-green-s20` source.

Shape:

```text
source frame + rough chroma alpha
  -> classify protected opaque core
  -> classify edge/partial-alpha fringe
  -> preserve core RGB untouched
  -> apply stronger key-channel decontamination only in fringe
  -> export still + WebM + ProRes MOV + APNG + preview composites
```

Verification:

- `webm.webm` is VP9 with `ALPHA_MODE=1`, 1280x720, 24 fps.
- `prores.mov` is ProRes 4444 with alpha (`yuva444p12le`), 1280x720, 216 frames.
- The run emitted cream, red, dark, and textured still composites.

Result: **negative / not promoted.** The mascot core is better protected than the failed global-loose-key attempts, but the fringe still contains obvious green/cyan/pink ghosting around the leaf ring, tail, and motion-blurred detail. The partial-alpha RGB recovery step appears to amplify mixed key pixels instead of cleaning them.

Current lesson: core/fringe separation is necessary, but heuristic fringe RGB recovery from a chroma plate is not sufficient for this clip.

### 3.9 Ran `v4-prior-fusion` with an off-the-shelf prior

Research pass:

- `rembg` is the most practical local spike path on Windows because it exposes a CLI/library and a model zoo including `bria-rmbg`, BiRefNet variants, ISNet, U2Net, and SAM-backed modes.
- `bria-rmbg` / BRIA RMBG-2.0 was the best one-frame candidate in this clip: it preserved the mascot and most of the leaf ring better than `birefnet-general`, `birefnet-general-lite`, `isnet-general-use`, and `u2netp`.
- `birefnet-massive` was competitive but did not clearly beat `bria-rmbg` on the review frame.
- `MatAnyone2` is the stronger next candidate for full video matting because it is video-aware and uses temporal propagation, but it requires a first-frame mask and a heavier Torch/CUDA/WSL-style setup.
- SAM2/Sammie-Roto are useful segmentation/rotoscoping aids, but segmentation masks alone are not enough for soft alpha around fur, leaves, and motion blur.

A `celstate-alpha-v4-prior-fusion` stage was added and run on the existing `test3-trim1-sampled-green-s20` source.

Shape:

```text
source frame + rembg/bria-rmbg RGBA prior + rough chroma alpha
  -> use the prior as the main matte
  -> use chroma only as background evidence
  -> preserve protected core RGB
  -> apply conservative key-channel decontamination in fringe only
  -> export still + WebM + ProRes MOV + APNG + preview composites
```

Verification:

- `webm.webm` is VP9 with `ALPHA_MODE=1`, 1280x720.
- `prores.mov` is ProRes 4444 with alpha (`yuva444p12le`), 1280x720, 216 frames.
- The run emitted cream, red, dark, and textured still composites.
- `report.json` records 216 frames, average alpha coverage `0.1908`, and prior model `bria-rmbg`.

Result: **positive but not final.** v4 is visibly better than v3 and avoids the v3 fringe color-ghost failure. It preserves the leaf ring better than several lighter priors. The remaining blocker is still RGB contamination at the edge: green rim remains around tail, leaves, fur, and motion-blurred details.

Operational lesson: CPU `rembg` with `bria-rmbg` works but is slow for 216 frames on Windows. Future full-clip prior experiments should use WSL/CUDA, a persistent service, or a video-native model rather than repeatedly spinning up per-frame or folder batch work.

### 3.10 Ran `v5-video-prior` with MatAnyone2 temporal matting

Shape:

```text
source.mp4
  -> first-frame BRIA mask seeds MatAnyone2
  -> MatAnyone2 pha/ supplies subject matte
  -> sharp per-frame chroma re-adds detached elements outside guard band
  -> inward-color spill pull + core/residual despill on fringe only
  -> export still + WebM + ProRes MOV + APNG + preview composites
```

Verification:

- `webm.webm` VP9 `alpha_mode=1`, 1280x720, 216 frames.
- `prores.mov` ProRes 4444 `yuva444p12le`.
- Leaf coverage ~3.9% via chroma guard-band recovery.

Result: **positive architecture, not final RGB repair.** MatAnyone2 eliminated harsh v4 silhouettes and preserved fur/leaf motion. Remaining defects were all variants of channel-clamp despill: faint tail tinge, desaturated leaves, muddy detached sparkles.

Negative finding: MatAnyone2 `fgr/` frames are **not** predicted clean foreground. They are source composited over a fixed pale-green plate (`#78FF9B`). Un-compositing reproduces source exactly; do not use `fgr` as an RGB prior.

### 3.11 Ran `v6-projection` with projection decontamination

Shape:

```text
source.mp4 + MatAnyone2 pha/ + sharp chroma alpha
  -> per-frame sure-background plate (outward fill from empty pixels)
  -> subject inward reference fill from deep core
  -> detached interior reference fill from chroma-opaque interiors
  -> projection decontamination: out = src - t*(bg-ref) along spill axis
  -> subject fringe + core band use subject ref; detached edge band uses detached ref; interiors untouched
  -> QA metrics + spill heatmap + export
```

Commands:

```bash
pnpm transparent-animation-spike video-prior --run-id <id>          # seed mask + MatAnyone2 (when available)
pnpm transparent-animation-spike celstate-alpha-v6-projection --run-id <id> [--prior-alpha-dir <pha-dir>]
pnpm transparent-animation-spike promote-review --run-id <id> --stage celstate-alpha-v6-projection
```

Result: **promoted on flagship clip.** Tail spill materially reduced on cream/red composites; leaf and sparkle color restored vs v5; olive jacket interior unchanged. Detached interiors measure 0 RGB delta vs source on frame 96. Synthetic truth still showed gaps: detached recall ~0.38, soft binarization ~0.79, residual spill ~0.22, edge alpha MAE ~0.21.

### 3.12 Shipped `v7` with color-line alpha fusion + matting-equation recovery

Shape:

```text
source.mp4 + MatAnyone2 pha/ + sharp chroma alpha
  -> reference seeding from key-free observations (filtered by core proximity)
  -> per-frame background plate filled to closure (outward from empty + eroded near fg evidence)
  -> color-line alpha estimate per pixel: src = a*ref + (1-a)*bg
  -> fuse baseline alpha with color-line estimate (weight capped, upward corrections gated)
  -> matting-equation foreground recovery: fg = src + ((1-a)/a) * (src - bg), gain capped
  -> evidence-gated detached path (color evidence, not hard distance)
  -> QA metrics + spill heatmap + export
```

Commands:

```bash
pnpm transparent-animation-spike video-prior --run-id <id>
pnpm transparent-animation-spike celstate-alpha-v7 --run-id <id> [--prior-alpha-dir <pha-dir>]
pnpm transparent-animation-spike promote-review --run-id <id> --stage celstate-alpha-v7
```

Result: **promoted on flagship clip and synthetic truth.** Detached alpha recall improved from ~0.38 to ~0.61 on `gt-sparks`; soft binarization dropped from ~0.79 to ~0.52; residual spill on `gt-smoke` dropped from ~0.22 to ~0.024; edge alpha MAE on `gt-tassels` improved from ~0.21 to ~0.11. The v7 stage is now the default in the spike harness and the `promote-review` default.

### 3.13 Added generalization probes (superseded as quality evidence)

Synthetic ffmpeg probes (`GP-01` blue screen, `GP-02` green glow) exercise key-agnostic projection without new provider video:

```bash
pnpm transparent-animation-spike generalization-probes --probe-duration 1
```

Probe runs can use `per-frame-prior` (BRIA via rembg) as evaluation plumbing. This is not a production fallback path. The loop is idempotent: rerunning reuses existing probe runs instead of failing on the existing directory.

**Honest limitations (2026-06 review):** these probes overclaim. GP-01 draws a hard-edged disc, not genuinely detached sparks — its `leafAddedCoverage` is 0, so the detached-element path is never exercised. GP-02 is a mostly binary circle, not genuine soft smoke. `detachedColorFidelity` measures unchanged pixels in a passthrough branch, so it is a regression tripwire, **not** independent quality evidence. Use the synthetic ground-truth eval (3.13) as the canonical generalization evidence; the probes remain only as cheap smoke tests of the full spike plumbing.

### 3.14 Phase 1: synthetic ground-truth eval + regression baseline

The measurement loop lives in `scripts/spikes/alpha-compiler/`:

```text
core.ts      pure numerical core extracted from the spike (projection decontamination,
             distance transforms, fills, v6 frame compiler) — no I/O, unit-tested
truth.ts     deterministic synthetic RGBA truth generators (seeded PRNG)
metrics.ts   truth-referenced per-frame metrics + aggregation with worst-frame pointers
baseline.ts  baseline build/compare logic with explicit per-metric tolerances
eval-cli.ts  pipeline CLI (`pnpm alpha-eval`)
baselines/synthetic-eval.json   committed regression baseline
alpha-compiler.test.ts          unit tests for all of the above
```

Pipeline per scenario: generate RGBA truth frames → composite over a noisy chroma plate → H.264 yuv420p round trip (crf 23) → ffmpeg `colorkey` chroma alpha → matting prior (`--prior`, below) → compiler core (`--compiler v6|v7`) → compare output against stored truth.

Prior modes (`--prior`):

- `simulated` (default) — truth alpha minus detached elements, gaussian-blurred. Deterministic and model-free; the canonical CI leg gated by the committed baseline.
- `bria` — real BRIA RMBG prior produced by `uvx rembg` over the decoded lossy frames. Real-prior evidence leg; depends on the rembg/onnxruntime toolchain, so its baseline is machine-pinned.
- `dir` — externally produced gray alpha frames (e.g. a MatAnyone2 `pha/` tree generated on a CUDA box), passed via `--prior-alpha-dir`; per-scenario subdirectories (`<dir>/<scenario-id>/`) are resolved automatically.

Real-prior runs write to their own roots (`tmp/alpha-compiler-eval-<prior>`) and baseline files (`baselines/synthetic-eval-<prior>.json`), and `compare` refuses to gate a report against a baseline produced with a different prior mode — the canonical simulated leg can never be clobbered or confused with a real-prior leg.

Scenarios (640x360, 48 frames, all deterministic):

- `gt-sparks` — opaque subject shedding genuinely detached fading sparks (detached-element path, small soft geometry, green key);
- `gt-smoke` — drifting soft smoke plumes + glowing ember (genuine partial alpha, green key);
- `gt-tassels` — scarf band with thin swinging 1.5–3 px strands (fine repeated structures, blue key).

Commands:

```bash
pnpm alpha-eval run                  # full eval, writes tmp/alpha-compiler-eval/report.json (runScope: full)
pnpm alpha-eval run --scenario gt-sparks --frames 24   # partial loop (runScope: partial; overwrites report.json)
pnpm alpha-eval compare              # full-report gate: exit 1 on regression or incomplete/unbaselined coverage
pnpm alpha-eval compare --scenario gt-sparks   # scoped compare (required after partial run)
pnpm alpha-eval compare --allow-unbaselined    # exploratory only — permits scenarios/metrics missing from baseline
pnpm alpha-eval update-baseline      # rewrite the committed baseline after accepted changes

# real-prior legs (write to tmp/alpha-compiler-eval-<prior>, gated by synthetic-eval-<prior>.json)
pnpm alpha-eval run --prior bria                       # BRIA RMBG prior via uvx rembg
pnpm alpha-eval run --prior dir --prior-alpha-dir <d>  # external prior frames (MatAnyone2 pha/)
pnpm alpha-eval compare --prior bria
pnpm alpha-eval update-baseline --prior bria
```

Partial vs full reports: every `run` writes top-level `report.json` with `runScope` and `includedScenarioIds`. A partial run replaces any previous full report — `compare` without `--scenario` fails on partial reports so stale full baselines cannot be mistaken for a fresh partial loop. Full `compare` also requires all canonical scenarios (`gt-sparks`, `gt-smoke`, `gt-tassels`) in `includedScenarioIds`.

Per-frame artifact split (do not confuse these):

| Path | Purpose |
|------|---------|
| `tmp/alpha-compiler-eval/<scenario>/frames.json` | Truth-referenced eval metrics (canonical regression evidence) |
| `tmp/.../celstate-alpha-v6-projection/per-frame-metrics.json` | Spike-stage compiler stats only (`residualSpill`, `temporalAlphaDelta`, etc.); not compared to baseline |

Per-frame metrics are persisted in `tmp/alpha-compiler-eval/<scenario>/frames.json`; aggregates carry `worstFrame` pointers so "where did this fail?" is answerable by frame number. The committed baseline pins both mean and worst-frame values for each metric. Metrics: `alphaMae`, `edgeAlphaMae`, `edgeRgbMae`, `fgRgbMae`, `falseTransparentRate`, `falseOpaqueRate`, `residualSpill` (key-dominance excess vs truth), `softAlphaMae` + `softBinarizationRate`, `detachedAlphaRecall` + `detachedRgbMae`, `temporalAlphaInstability` (output alpha change not explained by truth motion), and `priorAlphaMae` as the context floor for prior quality.

Honest limitations:

- The **canonical CI leg** uses a prior simulated from truth (blurred, detached elements removed). This isolates the compiler's contribution deterministically but does not measure real prior failure modes — that is what the `--prior bria` / `--prior dir` legs are for.
- The BRIA leg depends on rembg/onnxruntime inference, so its baseline is pinned to a machine + toolchain and is evidence, not a portable CI gate. The MatAnyone2 leg (`--prior dir`) requires inference on a CUDA box.
- Baseline tolerances (`max(0.005, 15%)`) apply to both metric means and worst-frame values to absorb ffmpeg/x264/sharp version drift; the baseline records toolchain versions so cross-machine drift is diagnosable.

v7 baseline numbers (2026-06, committed in `baselines/synthetic-eval.json`):

| Scenario | Metric | v6 mean | v7 mean | Direction |
|----------|--------|---------|---------|-----------|
| `gt-sparks` | `detachedAlphaRecall` | ~0.38 | **0.61** | ↑ significantly |
| `gt-sparks` | `softBinarizationRate` | ~0.79 | **0.52** | ↓ significantly |
| `gt-sparks` | `residualSpill` | — | **0.004** | ↓ (negligible) |
| `gt-smoke` | `residualSpill` | ~0.22 | **0.024** | ↓ significantly |
| `gt-smoke` | `softAlphaMae` | — | **0.008** | ↓ (preserved) |
| `gt-tassels` | `edgeAlphaMae` | ~0.21 | **0.11** | ↓ significantly |
| `gt-tassels` | `falseOpaqueRate` | ~0.012 | **0.006** | ↓ significantly |

The v7 improvements came from:
- **Color-line alpha fusion** — per-pixel two-color model estimates alpha where the prior is soft or missing, with confidence-weighted blending capped at `COLOR_LINE_MAX_WEIGHT`;
- **Matting-equation foreground recovery** — inverts straight-alpha compositing against the per-frame background plate, with gain capping to prevent noise amplification at low alpha;
- **Evidence-gated detached path** — re-adds detached elements based on color evidence (not hard distance), preserving soft alpha where the prior deleted particles;
- **Reference seed filtering** — key-free observations are only used as reference seeds when sufficiently distant from the prior core, preventing contaminated thick-structure edges from polluting the fill;
- **Background plate erosion** — sure-background seeds are eroded near foreground evidence so faint halos cannot pollute the background plate used for matting recovery.

### 3.15 Real-prior eval leg (BRIA): v7 holds on an imperfect prior

Ran 2026-06-12 on this machine (macOS arm64, rembg `bria-rmbg` via `uvx`). Methodology:

- `pnpm alpha-eval run --prior bria` — same three truth scenarios, prior produced by BRIA RMBG over the *decoded lossy frames* (not truth-derived);
- v6 then ran against the **identical captured prior frames** via `--prior dir --prior-alpha-dir` (per-scenario symlink staging onto the captured `prior-alpha/` dirs), so the v7-vs-v6 comparison shares one prior bit-for-bit and also validates the external-dir ingestion path end to end;
- baseline written to `baselines/synthetic-eval-bria.json` (machine-pinned evidence, not a portable CI gate); `compare` refuses cross-prior baselines.

Results (means):

| Scenario | Metric | v7 simulated | v7 BRIA | v6 same BRIA prior |
|----------|--------|--------------|---------|--------------------|
| `gt-sparks` | `detachedAlphaRecall` ↑ | 0.62 | 0.56 | 0.53 |
| `gt-sparks` | `softBinarizationRate` ↓ | 0.53 | 0.69 | 0.75 |
| `gt-smoke` | `residualSpill` ↓ | 0.021 | 0.098 | 0.124 |
| `gt-smoke` | `softBinarizationRate` ↓ | 0.00 | 0.79 | 0.82 |
| `gt-smoke` | `edgeRgbMae` ↓ | 0.048 | 0.137 | 0.159 |
| `gt-tassels` | `edgeAlphaMae` ↓ | 0.115 | 0.070 | 0.079 |
| `gt-tassels` | `residualSpill` ↓ | 0.002 | 0.006 | 0.016 |
| `gt-tassels` | `softBinarizationRate` ↓ | 0.00 | 0.09 | 0.14 |

Findings:

1. **v7 > v6 on every target metric under the real prior.** The v7 mechanism gains (color-line fusion, matting-equation recovery, evidence-gated detached path) are not artifacts of the simulated prior. This was the question the leg existed to answer.
2. **Detached recall holds** (0.56 vs 0.62 simulated; v6 ~0.53 on the same prior, ~0.38 historically).
3. **Genuine soft alpha is prior-bound.** BRIA is a salient-object segmenter: it binarizes smoke at the prior level (`softBinarizationRate` 0.79 vs 0.00 simulated) and the compiler recovers only part of the loss. Soft smoke/glow content needs a matting-class prior — exactly what the MatAnyone2 leg decides.
4. **Thin strands improved under the real prior** (`edgeAlphaMae` 0.070 vs 0.115): the crisp BRIA matte beats the gaussian-blurred simulated prior on fine geometry, so the simulated prior's blur was the limiter there, not the compiler.
5. **Metrology note:** `priorAlphaMae` understates prior damage on soft content (background pixels dominate the mean) — read it together with `softBinarizationRate`.

Ops notes:

- A single `rembg p` over a whole frame directory **deadlocked mid-batch** on macOS (thread-pool hang; last frame written, then 90 minutes of silence). The eval CLI now runs rembg in small watchdogged batches (12 frames, 7-minute timeout, 3 attempts, stray-process cleanup) and **reuses completed cutouts on rerun** (`prior-rgba/` survives the per-scenario wipe in bria mode), so an interrupted BRIA leg resumes instead of restarting.
- The dir-mode staging pattern for reusing captured priors: `ln -sfn <root>/<scenario>/prior-alpha tmp/<staging>/<scenario>` then `--prior dir --prior-alpha-dir tmp/<staging>`.

---

## 4. Current Failure Taxonomy

### 4.1 Green fringe / edge halo

The most visible defect is green contamination along the mascot silhouette, hair/fur, tail, leaves, and motion blur.

This is partly alpha and partly RGB. Even if alpha is reasonable, the foreground RGB can still contain green-screen spill.

### 4.2 Foreground erosion from aggressive keying

Loose keying can remove background better, but it also damages foreground. This shows up as red or cream leaking through the subject when composited over test backgrounds.

### 4.3 Background plate contamination

A temporal background estimate can accidentally include foreground when the subject occupies a region in many sampled frames. That turns the background model into a subject ghost and leaves plate residue.

### 4.4 Fine-detail ambiguity

Leaves, fur, hair tufts, cloth edges, and motion blur are hard because their true alpha is partial and their RGB is mixed with the key color.

### 4.5 Fringe RGB recovery amplification

The `v3-core-fringe` run showed that solving RGB with the simple matting equation against the sampled chroma color can create new colored ghosts. In uncertain partial-alpha regions, the recovered foreground RGB may be less faithful than the original keyed RGB.

This is a distinct failure from ordinary green spill: the algorithm can over-repair an ambiguous edge and turn mixed pixels into visible cyan/pink/red-green doubles.

### 4.6 Export compatibility is mostly solved for the spike

The harness can produce WebM with alpha metadata and ProRes MOV with alpha. The remaining work is quality, not basic export plumbing.

### 4.7 Prior quality vs edge RGB quality

The `v4-prior-fusion` run showed that a stronger external matte prior is a real quality jump, but it does not automatically solve foreground RGB. The prior can decide “foreground” correctly while the RGB still carries green-screen contamination from the generated source.

This reframes the next blocker: the matte is closer, but the edge color still needs a safer RGB repair method than chroma-matting equation recovery.

### 4.8 Channel-clamp despill ceiling (v5)

Pull-to-inward-color and dominant-channel despill can only **desaturate** mixed pixels. They cannot reconstruct white fur or yellow leaves contaminated by the plate. Raising spill gain damages legitimate green-adjacent interiors (olive sweater).

### 4.9 MatAnyone2 fgr is not foreground RGB

Treating `fgr/` as a clean foreground prior fails. MatAnyone2 outputs source-over-green composites, not decontaminated RGB.

### 4.10 Video-prior environment fragility

`video-prior` seeds masks via `rembg bria-rmbg` reliably for spike experiments. MatAnyone2 via `uvx` has failed to build on Windows (hatchling wheel collision), so the production-quality path should be tested directly on Windows WSL2/CUDA using the upstream MatAnyone2 install/inference flow. Do not design runtime fallback behavior around BRIA.

---

## 5. Near-Term Avenues to Explore

Use existing generated videos first. The immediate goal is to reduce the green outline without deleting foreground detail.

### 5.1 Edge-only RGB despill

Separate alpha generation from RGB repair.

Planned shape:

```text
rough alpha
  -> derive opaque core / transparent background / semi-transparent fringe
  -> leave foreground core RGB untouched
  -> apply aggressive despill only in the fringe
  -> composite over red, cream, dark, and textured backgrounds
```

Why this is promising:

- the defect is localized to edges;
- global despill risks changing legitimate foreground colors;
- fringe-gated despill can be much more aggressive without damaging the mascot interior.

Status: partially tested in `v3-core-fringe`. It preserved more foreground interior, but did not solve the edge artifact because the current fringe matte and RGB recovery are too ambiguous around leaves and motion blur.

### 5.2 Core/fringe matte refinement

Build two mattes instead of one:

- **Core matte:** conservative, protects the subject interior and keeps alpha opaque.
- **Fringe matte:** wider, only used for edge transparency and RGB decontamination.

This should address the current tradeoff where tight keys leave halos and loose keys erase foreground.

### 5.3 Better background plate estimation

Improve the failed v2 direction by excluding foreground before estimating the plate.

Candidate methods:

- use only known-empty regions from early/late frames;
- sample corners and borders but reject regions with high temporal variance;
- build a per-pixel plate from the most key-colored observation, but ignore frames where nearby foreground/motion is detected;
- manually annotate or infer a safe background mask for the first few experiments.

### 5.4 Off-the-shelf segmentation or matting prior

If heuristic keying plateaus, add a stronger foreground prior from an existing model/API/tool. The Alpha Compiler should not become just a wrapper around that tool; the value is combining the prior with temporal stabilization, RGB decontamination, export QA, and failure scoring.

Status: tested in `v4-prior-fusion` with `rembg` + `bria-rmbg`. This is the biggest quality jump so far, but it still leaves edge RGB contamination. The next prior step should be video-aware (`MatAnyone2` or equivalent), not another static-frame-only sweep unless it specifically targets edge color repair.

### 5.5 Temporal matte stabilization

After spatial matte constraints are improved, stabilize alpha over time:

- suppress frame-to-frame matte breathing;
- preserve thin leaves/particles without flicker;
- avoid smoothing bad matte decisions into neighboring frames.

This should come after core/fringe separation, not before.

### 5.6 Native-RGBA and background-removal benchmarking

Benchmark native-RGBA or background-removal providers only as comparators. The question is not “can someone output alpha?” The question is whether Celstate can produce a more trustworthy transparent motion asset through QA, refinement, and export hardening.

---

## 6. Current Recommended Next Experiment

Do **not** default to new provider video for the flagship clip — v7 is promoted.

**Real-prior eval leg:** BRIA half **done 2026-06-12** (section 3.15) — v7 held on every target metric against v6 on the identical real prior, unblocking production-worker design for subject + detached content. BRIA is evaluation evidence only, not a product dependency. Remaining half: the **MatAnyone2 leg** — generate MatAnyone2 alpha outputs for the three scenario `source.mp4` files on the target Windows WSL2/CUDA machine and ingest with:

```bash
pnpm alpha-eval run --prior dir --prior-alpha-dir <matanyone-pha-root>
```

This decides the soft-content stance: segmentation-class priors binarize smoke (3.15, finding 3), so soft alpha needs MatAnyone2-quality matting to ship. If MatAnyone2 fails the bar, soft smoke/glow content is deferred; we do not silently downgrade to a weaker prior.

**Generalize (canonical loop):**

```bash
pnpm alpha-eval run
pnpm alpha-eval compare
```

Success criteria for generalization:

- `pnpm alpha-eval compare` passes against the committed v7 baseline after harness-only changes;
- compiler changes that claim quality wins must move the truth-referenced metrics (detached recall, soft binarization, residual spill, edge alpha MAE) in the right direction and update the baseline deliberately via `update-baseline`;
- mechanism fixes only — no clip-specific or scenario-specific tuning.

The legacy ffmpeg probes (`generalization-probes`) remain as plumbing smoke tests only — see 3.13 for why they are not quality evidence.

**Video-prior reproducibility:**

```bash
pnpm transparent-animation-spike video-prior --run-id <id>
```

For the MatAnyone2 decision gate, run the upstream MatAnyone2 path on Windows WSL2/CUDA and pass its alpha output through `--prior-alpha-dir`. If setup fails, fix the setup or mark the gate blocked; do not replace it with BRIA and call it production evidence.

**Spike harness default stage:**

```bash
pnpm transparent-animation-spike celstate-alpha-v7 --run-id <id> [--prior-alpha-dir <pha-dir>]
pnpm transparent-animation-spike promote-review --run-id <id>  # default stage is now v7
```

Escalation rule:

- Celstate owns prior-fusion, projection decontamination, color-line fusion, matting-equation recovery, QA metrics, and export hardening around video mattes.
- If a future native-RGBA provider fully solves quality with no compiler layer, shift R&D toward benchmarking, workflow UX, and export QA.
- No fallback ladder in production. A production worker should use the chosen prior path, prove it is reliable, and fail closed with actionable diagnostics when it cannot produce a trustworthy alpha prior.

---
## 7. Durable Product Thesis

Celstate should not try to own video generation broadly. Celstate should own the conversion of generated motion into trustworthy transparent motion assets.

The narrow first wedge remains:

> A humanoid mascot crosses a transparent canvas, turns back with personality, and wind-blown leaves or particles move coherently around them, exported as OBS/editor-ready alpha video.

If we can make that one workflow feel magical, the Alpha Compiler has a credible path. If we only wrap a single upstream model, every upstream improvement commoditizes us.
