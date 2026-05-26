# Transparent Animation R&D Spike

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

We are **not blocked on video generation** for the first mascot wedge. Existing generated videos are good enough for transparency R&D. Do not generate new provider videos unless a local alpha experiment proves the current sources cannot answer the question.

We are currently blocked on **matte quality and foreground RGB repair**:

- the alpha can be generated;
- the exports can carry alpha;
- the mascot motion and identity are usable;
- the remaining visible defect is green fringe/edge contamination and occasional foreground damage from aggressive keying.

The current promoted review artifact is still under:

```text
tmp/transparent-animation-spike/review/test3-trim1-sampled-green-s20/
  transparent-still.png
  transparent-still-on-cream.png
  transparent-still-on-red.png
  transparent-animation.webm
  transparent-animation-prores.mov
  animation-on-cream-preview.mp4
  animation-on-cream-contact-sheet.jpg
```

These files came from the existing source video:

```text
tmp/transparent-animation-spike/runs/test3-trim1-sampled-green-s20/source.mp4
```

Verification from the promoted review candidate:

- `transparent-still.png` is RGBA, 1280x720.
- `transparent-animation.webm` is VP9 WebM with `alpha_mode=1`, 1280x720, 9 seconds.
- `transparent-animation-prores.mov` is ProRes with alpha (`yuva444p12le`), 1280x720, 216 frames.

The promoted review candidate is not final quality. It is a credible baseline with visible green outline that proves the next work should focus on alpha refinement, not more video generation.

The latest local prior-fusion candidate exists at:

```text
tmp/transparent-animation-spike/runs/test3-trim1-sampled-green-s20/celstate-alpha-v4-prior-fusion/
```

It is the strongest local result so far and is ready for visual review, but it is **not automatically promoted** until reviewed side-by-side. It preserves the mascot and leaf ring better than `v3-core-fringe` and avoids the v3 cyan/pink ghost doubles, while still leaving a visible green rim around tail, leaves, fur, and motion-blurred detail.

The previous `v3-core-fringe` experiment remains a negative result: protected-core / fringe-only RGB repair preserved the mascot interior, but heuristic fringe RGB recovery created visible color ghosting around leaves, tail, and motion-blurred edges.

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

Do **not** generate a new video yet.

Use:

```text
tmp/transparent-animation-spike/runs/test3-trim1-sampled-green-s20/source.mp4
```

The previous recommended off-the-shelf prior experiment has now been tried with `rembg` + `bria-rmbg` and produced the best local result so far:

```text
tmp/transparent-animation-spike/runs/test3-trim1-sampled-green-s20/celstate-alpha-v4-prior-fusion/
```

Next experiment:

```text
existing source video
  -> seed a video-aware matting prior from the v4/BRIA first-frame mask or a SAM2/Sammie-Roto mask
  -> run MatAnyone2 or equivalent temporal video matting
  -> fuse video prior + chroma into protected core / uncertain fringe / sure background
  -> repair edge RGB using conservative inward-color / spill-confidence logic, not partial-alpha chroma equation recovery
  -> export still + WebM + ProRes MOV
  -> compare over cream, red, dark, and textured backgrounds
```

Success criteria:

- less visible green outline than both the promoted review candidate and `v4-prior-fusion`;
- preserve the v4 leaf-ring coverage without reintroducing v3 cyan/pink/red-green ghost doubles;
- no new red/cream leakage through the mascot body, face, jacket, fur, or leaves;
- stable enough animation to judge over the full 9-second clip;
- WebM and ProRes alpha exports still verify correctly.

Escalation rule:

- If MatAnyone2 or another video-aware prior materially improves edge stability, Celstate should own the prior-fusion, RGB repair, QA, and export layer around it.
- If the video-aware prior fully solves the clip with no Celstate layer, shift R&D toward provider benchmarking, workflow UX, and export QA instead of custom matting.
- If setup cost blocks iteration, first optimize the local prior pipeline by running the prior in WSL/CUDA or as a persistent service; the Windows CPU `rembg` path is valid but too slow for rapid sweeps.

---
## 7. Durable Product Thesis

Celstate should not try to own video generation broadly. Celstate should own the conversion of generated motion into trustworthy transparent motion assets.

The narrow first wedge remains:

> A humanoid mascot crosses a transparent canvas, turns back with personality, and wind-blown leaves or particles move coherently around them, exported as OBS/editor-ready alpha video.

If we can make that one workflow feel magical, the Alpha Compiler has a credible path. If we only wrap a single upstream model, every upstream improvement commoditizes us.
