# Transparent Animation R&D — Consolidated Record

> **Status:** ARCHIVED / SUPERSEDED. Frozen 2026-06-13.
> **What this is:** the single consolidated record of the *video-source + alpha-matting* line of R&D (the "Alpha Compiler"). It merges the former `docs/product/TRANSPARENT-ANIMATION-RD-SPIKE.md` (chronological history) and `docs/product/TRANSPARENT-ANIMATION-RD-SPIKE.html` (operating brief), both now retired.
> **Superseded by:** [`docs/product/LIVING-UI-ANIMATION-SPIKE.html`](../../product/LIVING-UI-ANIMATION-SPIKE.html) — the active direction (generated sprite sheets via difference matting, React Native focus).
> **Read §0 first.** It records *why* this path was set down and what carries forward. Everything after §0 is preserved hard-won technical history; it is correct as history but is **no longer the plan**.

---

## 0. Why this is archived — strategic re-evaluation (2026-06-13)

This section is the durable output of a step-back review. It exists so the reasoning never has to be re-derived. Notation is used deliberately where English is lossy.

### 0.1 The vision was re-scoped (this is the root cause of everything below)

The implicit vision this R&D was optimizing for was *"vibrant transparent assets,"* read as **character/editorial animation including semi-transparent FX** (smoke, glow, hair, wispy volumetrics). The corrected, explicit vision is different:

> **Living UI.** Celstate makes apps feel *alive* instead of sterile. The assets are decorative/functional motion elements dropped into a running app: a button with overgrown bushes swaying in the wind, a slider riding railroad tracks, a background that teems with life. The opposite of the uniform flat-design sameness every app has now.

Let `A` be the asset class we actually serve. The corrected target class is

```
A* = { stylized, mostly-opaque objects in motion, with bounded soft edges }
```

and crucially

```
{ soft volumetrics: smoke, glow, mist, fine hair }  ∉  MVP(A*)
```

These are **corner cases, not requirements.** This single reclassification invalidates most of the difficulty this R&D fought.

### 0.2 Consequence — we were solving the hardest, least-relevant part of the problem

Alpha recovery is hard *only* in the partial-opacity regime. For the corrected class `A*`:

```
α(x) ∈ {0, 1}  for almost all pixels x   (opaque object on empty canvas),
α(x) ∈ (0,1)   only on a thin anti-aliased edge band of measure → 0.
```

The entire v3→v7 effort (color-line fusion, projection decontamination, matting-equation foreground recovery, soft-binarization metrics, `gt-smoke`) was aimed at faithfully recovering `α ∈ (0,1)` on smoke/hair — i.e. precisely the regime we just declared out of scope. That effort is **off-vision**, not wrong.

### 0.3 Consequence — the two remaining "blockers" were artifacts of the source choice, not of the vision

| Active blocker at archival | Real cause | Status under corrected vision |
|---|---|---|
| Reserved right/bottom **watermark** safe-zone fails (Hapnington HP-01/02/03) | We chose **Veo / Gemini** as the RGB source; it stamps a corner watermark | Imported artifact of a commodity provider. Not fundamental. |
| **Soft-alpha binarization** (`gt-smoke softBinarizationRate ≈ 0.79`) | Matting priors (BRIA, MatAnyone2) binarize genuine partial alpha | The corner case we descoped in §0.1 |

Neither blocker is a property of *living-UI assets*. Both are properties of *"recover alpha from opaque consumer-grade generated video."*

### 0.4 Consequence — generation is not the moat

Generation models are commoditizing. Let `M` be defensible moat. The finding:

```
M ≠ f(generator)          # Veo, Wan-Alpha, Runway, Kling, Sora … are commodity inputs
M  = f(consumption layer)  # runtime, right-sizing, density, theming, curation, drop-in UX
```

This retires two earlier positions at once:
- the **native-RGBA / Wan-Alpha** decision (former `TRANSPARENT-ANIMATION-BIBLE.md`) — correct that matting can't make soft alpha, but it put the bet on *owning/depending on a commodity generator*, which builds no moat;
- the **"Alpha Compiler as the product"** framing — a source-agnostic matting/QA layer is real engineering, but as a *primary alpha source* on opaque video it inherits §0.2 and §0.3.

### 0.5 Consequence — consumption is the real risk, and it disfavors raster video

The unexamined risk was never "can we make alpha?" It was **"can a real app actually use these assets, at the right size, performantly?"** Transparent *video* answers this badly:

```
No universal transparent-video format:
  Chrome / Firefox / Android  ⇒  VP9-alpha in WebM
  Safari / iOS                ⇒  HEVC-alpha in MP4/MOV   (WebM alpha ignored)
  iOS + multiple WebM <video> ⇒  documented crashes
Right-sizing: raster, fixed resolution ⇒ upscale blur, DPR waste
Density ("teeming"): N simultaneous video decodes ⇒ battery / jank
```

For **React Native specifically** the situation is worse: there is no robust cross-platform transparent-video primitive at all. This is what motivates the successor direction.

### 0.6 The decision

**Pivot the animation engine from "video source + alpha matting" to "generated sprite sheets produced by our own difference-matting image pipeline,"** plus a rigged-deformation sibling. Rationale, in one line each:

1. **Reuses owned IP.** Difference matting (white/black two-pass, exact alpha) is *our* differentiator; a sprite sheet is one image, matted once.
2. **Deletes the alpha problem.** Clean, aligned alpha for every frame for free; no chroma key, no MatAnyone2, no spill repair, no watermark.
3. **Collapses cost.** One generation per animation (2 passes), not `2N` (see §8.3).
4. **Solves consumption.** A sheet is a PNG/WebP — plays everywhere, atlas-scales to density, loops, is interactive and themeable.
5. **Puts the moat where it belongs** — in the runtime/consumption layer (§0.4).

Full forward plan, math model, and React Native architecture live in the successor doc: [`LIVING-UI-ANIMATION-SPIKE.html`](../../product/LIVING-UI-ANIMATION-SPIKE.html).

### 0.7 What carries forward vs what is retired

**Carries forward (do not delete the code):**
- FFmpeg alpha **export hardening** (WebM VP9 `yuva420p`, ProRes 4444 `yuva444p10le`, APNG, frame ZIP) — reusable for any raster output.
- The **synthetic ground-truth eval methodology** (`scripts/spikes/alpha-compiler/`) and the discipline of *measured, regression-gated quality* rather than eyeballing one clip.
- Projection decontamination / color-line fusion **as an optional edge-refinement pass** — only if a future raster source ever needs spill cleanup. Never again as a primary alpha source.

**Retired as a primary engine:**
- Opaque-video + matting (Veo/Runway RGB → MatAnyone2/chroma → Alpha Compiler).
- Native-RGBA-as-product (Wan-Alpha et al. as the thing we own).
- Treating soft volumetrics (smoke/glow/hair) as an MVP requirement.

---

## 1. Durable thesis (historical framing)

> Original framing, retained for context. The "regardless of source" universality is exactly the over-generalization §0 corrects: a *production layer over generated motion* is valuable, but not as a primary alpha source on opaque video, and not as the moat.

The thesis was the **Celstate Alpha Compiler**:

```
generated RGB / native-RGBA / chroma video
  + prompt/reference context
  + rough matte or native alpha
  + temporal signals
  → refined foreground RGB
  → stable alpha video
  → confidence/artifact report
  → WebM / ProRes MOV / APNG / still exports
```

Why a transparent video remains hard from arbitrary RGB (still true, and still the reason §0.6 avoids it for opaque video): a final RGB pixel does not reveal `(F, α)`. With

```
C = F·α + B·(1−α)
```

one observation `C` underdetermines `(F, α)`. Chroma backgrounds add compression shift, spill, motion blur, and fine-edge ambiguity on top.

---

## 2. State at archival (June 2026)

- Flagship clip `test3-trim1-sampled-green-s20`: **v7 promoted**; deterministic export QA passes (WebM VP9 alpha, ProRes 4444, APNG, still PNG).
- Quality became **measurable**: synthetic ground-truth eval with committed baseline, `pnpm alpha-eval run` / `compare`, worst-frame pointers, unit-tested numerical core.
- **MVP gate FAILED** on the Hapnington safe-zone suite — foreground alpha entered the reserved right/bottom watermark zones on all three real UI-overlay cases (§6). This was the last active blocker when the line was archived.

Verification that was green at archival: `pnpm check`, `pnpm typecheck:tsc`, `pnpm lint:ts`, `pnpm test`, `git diff --check`, `pnpm alpha-eval run`, `pnpm alpha-eval compare`.

---

## 3. Technical history v0 → v7 (compressed, lessons preserved)

Local harness: `scripts/spikes/transparent-animation-spike.ts`; runs under `tmp/transparent-animation-spike/runs/<run-id>/`.

| Stage | Mechanism | Verdict | Enduring lesson |
|---|---|---|---|
| `v0` | FFmpeg `colorkey` + temporal alpha smoother | baseline | Single-color keying is experimental input, **not** exact alpha. |
| `v1-despill` | key → `alphaextract` → temporal smooth → despill-after-key → `alphamerge` | best early review candidate | Despill must run **after** keying; despill-before-key suppresses the plate so `colorkey` fails. |
| (loose key probe) | raise `colorkey similarity` to 0.5 | rejected | One global RGB radius broad enough for compressed bg also deletes green-adjacent foreground. Smaller output ≠ quality. |
| `v2-trimap` | temporal bg-plate + border-connected bg removal | not better than v1 | Moving foreground contaminates the plate → subject ghosts. Needs strong foreground exclusion. |
| `v3-core-fringe` | protect opaque core; key-channel decontam in fringe only | **negative** | Heuristic chroma matting-equation recovery on fringe creates cyan/pink/doubled ghosts. Core/fringe split necessary but not sufficient. |
| `v4-prior-fusion` | `rembg` **BRIA RMBG** prior as main matte; chroma as bg evidence | positive, not final | A strong external matte is a real jump; it does **not** fix edge **RGB** contamination. CPU rembg slow at 216 frames. |
| `v5-video-prior` | **MatAnyone2** temporal matte (BRIA-seeded) + chroma detached fusion + inward-pull despill | positive architecture | Temporal prior kills v4 silhouette breakage. **MatAnyone2 `fgr/` is source-over-`#78FF9B`, not clean foreground RGB — never use as RGB prior.** Channel-clamp despill only desaturates; can't reconstruct color. |
| `v6-projection` | per-frame sure-bg plate; projection decontam `out = src − t·(bg−ref)` along spill axis; detached interiors untouched | **promoted (flagship)** | Reconstructs mixed fringe RGB instead of desaturating. Detached interiors 0 RGB delta. Synthetic truth gaps remain. |
| `v7` | color-line alpha fusion (`src = α·ref + (1−α)·bg`) + matting-equation FG recovery (`fg = src + ((1−α)/α)(src−bg)`, gain-capped) + evidence-gated detached path + reference-seed filtering + bg-plate erosion | **promoted (flagship + synthetic truth); default** | Moved every target metric (§4). Gains held under a real prior (§5). This is as far as the matting line got. |

`v7` metric deltas vs `v6` (committed baseline `baselines/synthetic-eval.json`):

| Scenario | Metric | v6 | v7 | Dir |
|---|---|---|---|---|
| `gt-sparks` | `detachedAlphaRecall` | ~0.38 | **0.61** | ↑ |
| `gt-sparks` | `softBinarizationRate` | ~0.79 | **0.52** | ↓ |
| `gt-smoke` | `residualSpill` | ~0.22 | **0.024** | ↓ |
| `gt-tassels` | `edgeAlphaMae` | ~0.21 | **0.11** | ↓ |
| `gt-tassels` | `falseOpaqueRate` | ~0.012 | **0.006** | ↓ |

---

## 4. Synthetic ground-truth eval (the process change worth keeping)

`scripts/spikes/alpha-compiler/`: pure numerical `core.ts` (unit-tested, no I/O), deterministic RGBA `truth.ts`, truth-referenced `metrics.ts`, `baseline.ts` with per-metric tolerances, `eval-cli.ts` (`pnpm alpha-eval`), committed `baselines/synthetic-eval.json`.

Pipeline per scenario:

```
RGBA truth → composite over noisy chroma plate → H.264 yuv420p round-trip (crf 23)
  → ffmpeg colorkey chroma alpha → prior (--prior) → compiler core (--compiler v6|v7)
  → compare vs stored truth
```

Priors: `simulated` (truth-derived, blurred, detached removed — canonical CI leg); `bria` (real BRIA RMBG via `uvx rembg`, machine-pinned); `dir` (external `pha/` frames, e.g. MatAnyone2). `compare` refuses cross-prior baselines.

Scenarios (640×360, 48 frames, deterministic): `gt-sparks` (detached fading sparks), `gt-smoke` (soft plumes + ember — genuine partial alpha), `gt-tassels` (1.5–3 px swinging strands).

MVP gate semantics: default `compare` mode `--gate mvp` blocks only `gt-sparks` + `gt-tassels` on `{detachedAlphaRecall, edgeAlphaMae, residualSpill, softBinarizationRate}`. `gt-smoke` is **benchmark-only** (the smoke corner case §0.1, encoded into the gate before the vision was even fully named).

```
pnpm alpha-eval run                # full eval → tmp/alpha-compiler-eval/report.json
pnpm alpha-eval compare            # MVP gate
pnpm alpha-eval compare --gate strict
pnpm alpha-eval run --prior bria   # real-prior evidence leg (machine-pinned)
pnpm alpha-eval run --prior dir --prior-alpha-dir <matanyone-pha-root>
pnpm alpha-eval update-baseline
```

---

## 5. Real-prior legs (the legs that decided "soft alpha is prior-bound")

### 5.1 BRIA RMBG (2026-06-12) — v7 holds on an imperfect real prior

| Scenario | Metric (mean) | v7 simulated | v7 BRIA | v6 same BRIA prior |
|---|---|---|---|---|
| `gt-sparks` | `detachedAlphaRecall` ↑ | 0.62 | 0.56 | 0.53 |
| `gt-sparks` | `softBinarizationRate` ↓ | 0.53 | 0.69 | 0.75 |
| `gt-smoke` | `residualSpill` ↓ | 0.021 | 0.098 | 0.124 |
| `gt-smoke` | `softBinarizationRate` ↓ | 0.00 | **0.79** | 0.82 |
| `gt-tassels` | `edgeAlphaMae` ↓ | 0.115 | 0.070 | 0.079 |

Findings: v7 > v6 on every target metric under the real prior (gains are not simulated-prior artifacts); detached recall holds; **genuine soft alpha is prior-bound** — BRIA is a salient-object segmenter, it binarizes smoke at the prior level and the compiler recovers only part. `priorAlphaMae` understates soft-content damage (bg pixels dominate the mean) — read with `softBinarizationRate`. Ops: `rembg p` over a whole dir deadlocked on macOS; eval CLI now runs watchdogged 12-frame batches and reuses `prior-rgba/` on rerun.

### 5.2 MatAnyone2 (2026-06-13, Windows WSL2/CUDA) — soft smoke still fails

```bash
matanyone2 -i <scenario>/source.mp4 -m <scenario>/first-frame-mask.png -o <out> --save-image --max-size -1
pnpm alpha-eval run --prior dir --prior-alpha-dir tmp/alpha-compiler-eval-matanyone2-pha
```
First-frame masks were truth-derived → **optimistic** prior-quality probe, not production seeding.

| Scenario | Metric (mean) | v7 sim | v7 BRIA | v7 MatAnyone2 |
|---|---|---|---|---|
| `gt-sparks` | `detachedAlphaRecall` ↑ | 0.62 | 0.56 | 0.41 |
| `gt-smoke` | `softBinarizationRate` ↓ | 0.00 | 0.79 | **0.79** |
| `gt-tassels` | `edgeAlphaMae` ↓ | 0.115 | 0.070 | 0.080 |

Conclusion: even with an optimistic seed, `gt-smoke softBinarizationRate` stayed 0.79 → **soft smoke/glow does not ship on this prior.** Subject edges remain viable; detached sparks weaker than BRIA. No `dir` baseline committed (inspect `tmp/alpha-compiler-eval-dir/report.json`). WSL wrapper fixes: pass CLI args via `-ArgsJsonPath` so PowerShell doesn't consume `-i`/`-m`; run from `~/src/MatAnyone2`; do **not** pass `--max-size 1280` on 720p (upstream `new_h`/`new_w` bug) — native sizing produced 192 alpha frames/run.

---

## 6. Hapnington safe-zone suite (the last active blocker)

After founder review identified the bottom-right watermark risk, a **deterministic safe-action gate** was added: foreground alpha measured after watermark cleanup, before padding normalization; reserved union `R = { x ≥ 0.8·W } ∪ { y ≥ 0.8·H }`; MVP tolerances `alphaCoverageMax ≤ 0.002`, `opaqueCoverageMax ≤ 0.0005`; `promote-review` exits nonzero if export QA passes but `R` contains foreground alpha.

Three cases generated from local product context (`active-projects/hapnington`):

| Run | Use case | Export QA | MVP gate | `alphaCoverageMax` | `opaqueCoverageMax` |
|---|---|---|---|---:|---:|
| `hapnington-hp01-event-garland-blue-safe` | event-card garland | pass | **fail: reserved zone** | 0.042065 | 0.026819 |
| `hapnington-hp02-rsvp-flourish-blue-safe` | RSVP flourish | pass | **fail: reserved zone** | 0.061373 | 0.029225 |
| `hapnington-hp03-karaoke-overlay-blue-safe` | karaoke overlay | pass | **fail: reserved zone** | 0.972659 | 0.953583 |

The old flagship v7 package also fails the stricter gate, validating the watermark-zone concern. Provider notes: Doppler `dev` has Vertex creds (not `GEMINI_API_KEY`); used `veo-3.1-fast-generate-001` (the `-preview` variant 404s under Vertex).

**Conclusion at the time:** prompt-level safe-zone instruction is insufficient; next step would have been source-layout enforcement + reject/regenerate before alpha compile. **Conclusion now (§0.3):** this entire blocker is an artifact of using a watermarking opaque-video provider as the alpha source. The successor direction removes the provider, and with it the blocker.

---

## 7. Failure taxonomy (still-true engineering facts)

1. **Green fringe / edge halo** — part alpha, part residual spill in foreground RGB even when alpha is fine.
2. **Foreground erosion from aggressive keying** — loose key removes bg but punches holes in the subject.
3. **Background-plate contamination** — temporal bg estimate absorbs persistent foreground → subject ghost.
4. **Fine-detail ambiguity** — leaves/fur/hair/motion-blur have true partial alpha + mixed RGB. *(The §0.1 corner case.)*
5. **Fringe RGB recovery amplification** — matting-equation against sampled chroma can over-repair into colored doubles.
6. **Channel-clamp despill ceiling** — can only desaturate; cannot reconstruct white fur / yellow leaves.
7. **MatAnyone2 `fgr` ≠ foreground RGB** — it is source-over-`#78FF9B`.
8. **Video-prior environment fragility** — MatAnyone2 needs Windows WSL2/CUDA; `uvx` build collides on Windows (hatchling wheel). No BRIA fallback ladder in production.
9. **Reserved watermark/action-zone violations** — prompt text alone cannot keep generated foreground out of `R`; the gate must be deterministic, not visual.

---

## 8. Math appendix (formal definitions referenced above)

### 8.1 Difference matting (our exact-alpha primitive — carries into the successor)
Generate the same subject on white (`B=255`) and black (`B=0`):
```
C_w = F·α + 255·(1−α)
C_b = F·α
⇒  α = 1 − (C_w − C_b)/255      (per channel; take max over channels for robustness)
⇒  F = C_b / α                   (α > 0)
```
Exact, not approximate. This is why a *generated* asset on two backgrounds yields perfect alpha — the property the successor exploits on a single sprite sheet.

### 8.2 Reserved-zone gate (Hapnington)
```
R(W,H) = { (x,y) : x ≥ 0.8·W }  ∪  { (x,y) : y ≥ 0.8·H }
pass  ⇔  coverage_α(R) ≤ 0.002  ∧  coverage_opaque(R) ≤ 0.0005
```

### 8.3 Cost model (the argument that kills "per-frame is too expensive")
For an `N`-frame animation, with our two-pass alpha primitive:
```
C_per_frame  = 2N model passes      # generate each frame independently
C_single_sheet = 2  model passes    # generate all N cells in one image, matte once
speedup = C_per_frame / C_single_sheet = N
```
The former Bible dismissed per-frame stills as cost-prohibitive (`2N`). Single-sheet generation makes the cost `O(1)` in frame count — the dismissal does not apply to the successor.

### 8.4 Soft-alpha regime (why this line plateaued, restated)
```
difficulty(α-recovery)  high  ⇔  α ∈ (0,1) over a region of non-trivial measure
A*  (living-UI assets)  ⇒  μ{ x : α(x) ∈ (0,1) } → 0   (thin AA edge only)
⇒  the plateau metric (softBinarizationRate on gt-smoke) is irrelevant to A*
```

---

## 9. Operating notes (frozen)

- Canonical harness `scripts/spikes/transparent-animation-spike.ts`; canonical eval `scripts/spikes/alpha-compiler/` (`gt-sparks`, `gt-smoke`, `gt-tassels`).
- Historical promoted artifact `tmp/transparent-animation-spike/review/test3-trim1-sampled-green-s20/` — useful for alpha-quality reference, not MVP proof.
- Safe-zone packages under `tmp/transparent-animation-spike/review/hapnington-hp0{1,2,3}-*-blue-safe/`.
- Default compiler `v7`; do not resurrect older despill/keying except as baselines.
- No production fallback ladder; BRIA/rembg is eval-only, never a runtime path.
- This was always an R&D record, never a product spec or production-worker plan.

*Last shaped 2026-06-13 as the closing record of the video-matting line. Active work continues in [`LIVING-UI-ANIMATION-SPIKE.html`](../../product/LIVING-UI-ANIMATION-SPIKE.html).*
