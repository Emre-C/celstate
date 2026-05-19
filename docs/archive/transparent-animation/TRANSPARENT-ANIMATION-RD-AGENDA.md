# Model-Agnostic Transparent Animation — R&D Agenda

> **Companion to:** [`TRANSPARENT-ANIMATION-BIBLE.md`](TRANSPARENT-ANIMATION-BIBLE.md).
> **Status:** strategic course-correction; incorporates founder feedback from 2026-05-12.
> **Trigger:** "Wrapper around Wan-Alpha is not a moat" plus a sharper product bar: limited-but-magical beats broad-but-barely-functional.
> **Audience:** the team. Read before changing animation strategy, animation worker scope, or `/app/animations` product language.

---

## 1. The Durable Lesson

The bible asked too narrow a question:

> *"Which transparent video model should we call?"*

The better question is:

> *"What repeatable Celstate recipe can turn prompt-driven image/video models into awe-inspiring transparent motion assets?"*

The word **awe-inspiring** matters. The target is not a static sticker sliding around. The target is closer to: a humanoid mascot spans a horizontal stream canvas, reverses direction, reacts with personality, and wind-blown leaves flutter around them in the same directional flow. If we can only do that for humanoid mascots at first, that is acceptable. A constrained magical product is better than a universal mediocre one.

The still pipeline is the reference pattern, not because white/black backgrounds are sacred, but because it discovered a model-portable recipe:

```text
prompt constraint + paired raster evidence + deterministic alpha math + QA gates = portable transparency
```

The video equivalent may not be "generate the same video twice." It may be:

```text
prompt-constrained video + adaptive chroma key + temporal matting
pose/motion transfer + secondary motion fields
native RGBA video + Celstate QA
sparse generated keyframes + local inbetweening
```

The moat is the recipe stack: prompt contracts, palette-aware background selection, motion abstraction, temporal matte cleanup, pose/flow extraction, failure detection, and a growing empirical map of which engine works for which prompt class.

---

## 2. Enduring Lessons Learned

These lessons should survive individual model releases.

1. **Prompt-driven models are steerable instruments, not passive APIs.** We can ask for a flat chroma background, forbid that exact color elsewhere in the scene, request no shadows/reflections on the background, and require clean subject separation. The model will not obey perfectly, but obedience is measurable and worth exploiting.

2. **Single-color keying is not mathematically exact alpha recovery.** One RGB frame cannot uniquely solve both foreground color and alpha. But production transparency does not always require mathematical perfection. If the model obeys a strict "this exact color only appears in the background" contract, adaptive chroma keying may work for a large share of high-impact clips.

3. **Dual-background video matting is structurally suspect.** Same seed plus different background does not mean the same video. A video model may change pose timing, particles, lighting, cloth, wind, or camera path. Optical flow can correct small spatial drift; it cannot turn two different performances into one aligned pair.

4. **Per-frame image generation is the wrong economic shape.** Generating every frame with image models, especially with two backgrounds per frame, is too expensive and too drift-prone. Image generation should be used for references and sparse keyframes, not full-frame animation at video FPS.

5. **Humanoid-only can be a valid first wedge.** If pose/motion transfer gives us magical humanoid mascot clips, the limitation is acceptable. We should not kill a magical constrained path because it fails abstract logos or smoke-heavy stingers.

6. **Secondary motion is part of the magic.** Leaves, wind, cloth, hair, particles, glow pulses, and foreground/background parallax can make or break the result. The system must reason about motion fields, not just subject pose.

7. **Native RGBA video remains strategically important, but it is not the whole strategy.** Wan-Alpha, TransPixeler, LayerFlow, and future alpha-native models are valuable engines. They are not sufficient as Celstate's only moat.

8. **QA must measure the actual promise.** The important metrics are awe, internal motion, alpha usability, prompt compliance, subject identity, temporal coherence, and editor compatibility. Hardcoded passing metrics are forbidden.

---

## 3. Current Strategic Priorities

The top three ideas to explore now are:

| Priority | Technique | Why it matters |
| --- | --- | --- |
| 1 | **T11 — Adaptive Chroma-Key Magical Video** | Fastest path to using frontier video models for complex, cinematic, prompt-driven motion without needing two matching videos. |
| 2 | **T4+ — Humanoid Motion Transfer** | Best constrained path to controlled magical mascot movement: run, jump, spin, cross-screen, react, return. |
| 3 | **T7 — Native RGBA / Alpha Adapter Track** | Highest ceiling for true semi-transparent FX and long-term defensible ML IP. |

Supporting systems:

- **T5 — Secondary Motion Field / Layer System** powers wind, leaves, particles, glow, cloth, and composited environmental motion.
- **T3 — Sparse Keyframes + Alpha-Aware Inbetweening** rescues image models for key moments without paying per video frame.
- **T8 — Temporal Matting / Despill / Coherence** is required infrastructure for every non-native-alpha engine.
- **T6 — Engine Router** comes later, after we have multiple engines worth routing between.

Demoted ideas:

- **T1 — Dual-Background Video Matting** becomes a negative-control spike, not a pillar.
- **T2 — Full Reference-Conditioned Frame Chain** is not production-shaped; salvage only sparse keyframes.

---

## 4. Technique Catalogue

### T11 — Adaptive Chroma-Key Magical Video

**What it is.** Use any strong prompt-driven video model to generate one magical opaque RGB video on a deliberately chosen artificial background color, then remove that color with a serious chroma-key + segmentation + temporal matting stack.

This is not exact alpha math. It is a pragmatic bet that prompt-conditioned models can often obey a color-isolation contract well enough for production.

**Prompt contract.**

```text
Render the full scene on a flat, perfectly uniform #C000FF chroma background.
The #C000FF color must appear only in the background.
Do not use #C000FF, similar magenta/purple tones, or reflected magenta spill
on the mascot, leaves, clothing, particles, glow, shadows, motion blur, or props.
No floor, no wall texture, no contact shadows, no reflections.
Keep a clean readable silhouette suitable for chroma-key extraction.
```

The actual key color is not fixed. Choose it per prompt/reference by finding a color far from the subject palette: toxic magenta, electric cyan, acid green, saturated blue, or another "forbidden" hue. For the leaf/wind example, green is a bad key; magenta/purple is more plausible.

**Algorithm.**

```text
1. Analyze reference image / prompt palette.
2. Pick a key color maximally distant from expected subject and FX colors.
3. Generate one video with the explicit key-color contract.
4. Validate prompt compliance:
   - background flatness
   - key color absent from foreground
   - no floor/shadow/reflection contamination
5. Segment likely foreground and build a trimap.
6. Chroma-key sure-background pixels.
7. Matte uncertain edge bands with image/video matting.
8. Despill key color from foreground edges.
9. Apply temporal smoothing/flow-guided coherence to prevent matte flicker.
10. Export RGBA frames through existing FFmpeg alpha outputs.
```

**What we'd own.** The adaptive key-color selector, prompt contracts, compliance QA, matte/despill stack, temporal alpha smoothing, provider-specific prompt variants, and the empirical map of which models obey which isolation constraints.

**What's unknown.**

- Will frontier video models obey "do not use this color except the background" reliably enough?
- Can we keep awe-inspiring motion while also forcing a clean isolation background?
- How often do motion blur, shadows, glow, and semi-transparent FX become contaminated by the key color?
- Is the success rate closer to 30%, 60%, or 90% across Celstate's real use cases?

**Cost / time to first verdict.** ~$250 + 1 week. Run 10 hard prompts across 2-3 video models, 2 candidate key colors each, and score compliance + alpha quality.

**My honest read.** **First spike.** It directly addresses the strongest objections to T1/T2: it needs one video, not two, and it uses video models for what they are best at — magical motion.

---

### T4+ — Humanoid Motion Transfer / Cinematic Mascot Engine

**What it is.** A deliberately constrained engine for humanoid and semi-humanoid mascots. Use a generated or curated motion donor video to capture cinematic body motion, then transfer that motion onto a Celstate mascot with alpha extraction handled by T11, native RGBA, or another engine.

**Algorithm.**

```text
1. Generate or ingest a mascot reference.
2. Generate/select a motion donor:
   - sprint across horizontal canvas
   - turn back
   - leap / land / wave / react
   - dance / celebrate / point / present
3. Extract motion representation:
   - pose skeleton
   - depth
   - optical flow
   - camera path
   - wind direction / speed where visible
4. Render the mascot under that motion using pose/video-conditioned generation.
5. Add secondary motion: leaves, cloth, hair, particles, glow, wind trails.
6. Recover/export alpha via T11, native RGBA, or future alpha adapter.
```

**What we'd own.** Motion-donor library, pose cleanup, mascot-to-pose retargeting, prompt templates for cinematic mascot actions, secondary-motion coupling, and QA that knows whether the output is actually magical.

**What's unknown.**

- How strongly can we preserve a generated mascot's identity through complex motion?
- Do current pose-conditioned pipelines handle stylized mascots, not just humans?
- Can secondary motion be coupled to donor motion instead of looking pasted on?
- Does alpha extraction survive fast motion and motion blur?

**Cost / time to first verdict.** ~$300 + 2 weeks. Validate 6 humanoid mascot prompts with 3 motion families and at least one horizontal-canvas traversal.

**My honest read.** **Promote, do not kill.** This is the best path to "limited but magical." If it only works for humanoid mascots at first, that is still a compelling product wedge.

---

### T7 — Native RGBA / Trained Alpha Adapter Track

**What it is.** Maintain a high-ceiling track around native RGBA video generation and Celstate-owned alpha adapters. This includes testing Wan-Alpha / TransPixeler / LayerFlow-style systems and eventually training our own alpha LoRA or adapter on synthetic and curated transparent video data.

**Algorithm.**

```text
1. Benchmark native RGBA models on the hardest Celstate prompts.
2. Track whether I2V variants can preserve user/reference identity.
3. Use outputs from T11/T4+/T5/T3 as synthetic training candidates.
4. Train small alpha adapters or LoRAs on open video bases when the data is good enough.
5. Re-benchmark against new base models quarterly.
```

**What we'd own.** Evaluation harness, prompt suite, synthetic-data corpus, adapter weights, data-selection heuristics, and deployment knowledge across open bases.

**What's unknown.**

- Do native RGBA models preserve identity well enough for creator-owned mascots?
- Are current licenses and hosted endpoints commercially usable?
- How much training data is needed for a Celstate-quality alpha adapter?
- Does an adapter generalize across base models or require per-base tuning?

**Cost / time to first verdict.** ~$500 for baseline model testing; ~$5k+ for a real adapter spike.

**My honest read.** **Long-term moat.** This is the highest ceiling for smoke, glow, hair, translucent FX, and motion blur. It should run in parallel with the faster T11/T4+ product spikes.

---

### T5 — Secondary Motion Field / Layer System

**What it is.** A support engine that turns "wind blows left-to-right" or "magic leaves swirl around the mascot" into actual motion fields, particles, layer warps, and alpha-preserving compositing.

**Algorithm.**

```text
1. Infer scene forces from prompt or donor video: wind, impact, bounce, orbit, reveal.
2. Generate or extract layers: mascot, leaves, particles, glow, cloth, text.
3. Apply motion policies:
   - leaves follow wind field with turbulence
   - cloth/hair lag behind body motion
   - glow pulses from action beats
   - particles inherit velocity from mascot movement
4. Composite with alpha and export.
```

**My honest read.** Not a complete product alone, but essential to making T4+ and T11 feel authored rather than accidental.

---

### T3 / T2 — Sparse Keyframes + Alpha-Aware Inbetweening

**What it is.** Use image generation or image editing only for sparse keyframes, then locally interpolate, warp, or inbetween. Do not generate every frame.

**Correct shape.**

```text
2-4 generated keyframes + local interpolation = plausible cost
30-80 generated frames × 2 backgrounds = wrong cost
```

**My honest read.** Useful for blinks, tail wags, logo reveals, expression changes, and controlled poses. Not the primary path for cinematic motion.

---

### T1 — Dual-Background Video Matting

**What it is.** Generate the "same" video twice on white/black backgrounds and difference-matte each frame.

**Current read.** Keep only as a negative-control spike. The core assumption is likely false: prompt-driven video models are not obligated to repeat the same performance when the background changes. If this works on some provider, great; do not build strategy around it before proof.

---

### T8 — Temporal Matting, Despill, and Coherence

**What it is.** The post-processing stack required for T11 and useful for every non-native-alpha engine: segmentation, trimap construction, chroma keying, edge matting, despill, optical-flow-guided alpha smoothing, and flicker detection.

**My honest read.** Infrastructure, not a standalone engine. It should be built as a reusable library once T11 shows enough promise.

---

### T6 — Multi-Engine Router

**What it is.** A classifier and arbitration layer that chooses among T11, T4+, T7, T5/T3 combinations, and future engines.

**Current read.** Valuable later. Premature now. First we need at least two engines that can produce magical outputs.

---

### T9 — Latent-Space Alpha Injection

**What it is.** Inference-time guidance or latent intervention on open video diffusion models to encourage alpha-aware outputs without full training.

**Current read.** High-upside research, but not a near-term product bet. Revisit after the native RGBA and adapter track has better local infrastructure.

---

### T10 — Synthetic Data Bootstrap

**What it is.** Use successful outputs and deterministic layers from T3/T5/T11/T4+ to build a curated transparent video corpus for T7.

**Current read.** Compounding background strategy. Every spike should preserve artifacts, prompts, masks, failures, and scores so future training data is not lost.

---

## 5. Evaluation Rubric

Each spike must produce a written memo and scored artifacts. The core metrics:

| Metric | Question |
| --- | --- |
| **Awe score** | Would this make a user say "I didn't know Celstate could do that"? |
| **Internal motion** | Do independent components move meaningfully, not as one rigid card? |
| **Prompt compliance** | Did the model obey key constraints, especially chroma isolation? |
| **Alpha usability** | Does the clip drop onto arbitrary backgrounds without obvious haloing/spill? |
| **Temporal coherence** | Does the matte flicker, breathe, or crawl? |
| **Subject identity** | Is the mascot/logo/character stable across the clip? |
| **Secondary motion coupling** | Do leaves, particles, cloth, hair, and glow respond to scene motion? |
| **Economics** | Is the method compatible with credit pricing and reasonable retries? |
| **Editor compatibility** | Does WebM/MOV/APNG import with alpha into OBS and editors? |

Manual scoring is acceptable in the first spike. Faking a metric is not.

---

## 6. Immediate R&D Portfolio

| Spike | Technique | Cost | Time | What it tests | Kill / demote criterion |
| --- | --- | --- | --- | --- | --- |
| S1 | T11 Adaptive Chroma-Key Magical Video | ~$250 | 1 wk | Can prompt-driven video models obey a strict key-color contract while producing magical motion? | Demote if foreground key contamination or matte failure ruins >60% of hard prompts. |
| S2 | T4+ Humanoid Motion Transfer | ~$300 | 2 wk | Can we produce at least one magical humanoid mascot traversal/reaction? | Demote if no output clears the awe bar after 6 serious attempts. |
| S3 | T7 Native RGBA Baseline | ~$500 | 2 wk | Are native RGBA models already strong enough on Celstate prompt classes? | Demote if identity/alpha/fidelity fail on practical creator assets. |
| S4 | T5 Secondary Motion Field | ~$150 | 1.5 wk | Can wind/leaves/particles/cloth be coupled to mascot motion convincingly? | Demote if it reads as pasted-on decorative noise. |
| S5 | T3 Sparse Keyframes | ~$150 | 1 wk | Can sparse generated keyframes add controlled expression or pose changes cheaply? | Restrict to logos/simple loops if identity drifts across 2-4 keyframes. |
| S6 | T8 Matting Infrastructure | ~$100 | 1 wk | Does temporal matte/despill materially improve T11 outputs? | Keep only if QA improves visibly on real artifacts. |

The first externally compelling demo should be constrained and ambitious:

> **A humanoid mascot crosses a horizontal transparent canvas, turns back with personality, and wind-blown leaves move coherently around them, exported as OBS-ready alpha video.**

That demo is more valuable than broad support for seven use cases with timid motion.

---

## 7. What This Changes In The Bible

The bible should be revised after the first spike results, but this agenda changes the operating assumptions immediately:

1. **Opaque video + matting is not permanently disqualified.** Generic "trust matting" remains weak, but prompt-constrained adaptive chroma keying is a serious experiment because these are prompt-driven models.
2. **Dual-background video is no longer the default analogy to the still pipeline.** It is a testable idea, but the current default assumption should be skepticism.
3. **Per-frame image generation is not a product path.** Image generation belongs in references and sparse keyframes.
4. **Humanoid-first is acceptable.** If T4+ is magical but narrow, it can be the wedge.
5. **Native RGBA is one engine, not the whole strategy.** It is the high-ceiling track for true transparent FX and future ML IP.
6. **The product should optimize for one magical constrained workflow before broad mediocre coverage.**

---

## 8. Honest Bottom Line

The previous agenda improved on the Wan-Alpha wrapper plan, but it still over-indexed on provider/model abstraction and under-indexed on magic.

The stronger strategy is:

```text
Use prompt-driven models aggressively.
Constrain them with chroma/background contracts.
Exploit humanoid motion transfer where it creates awe.
Add secondary motion fields so the scene feels alive.
Keep native RGBA and alpha adapters as the long-term moat.
Measure everything.
```

If adaptive chroma keying works even 60-70% of the time on the right prompt classes, it may unlock the fastest path to magical transparent video. If humanoid motion transfer works for mascot clips, the limitation is not a failure; it is a wedge. If native RGBA catches up, it becomes the high-fidelity engine in the same stack.

The goal is not to produce any transparent animation. The goal is to produce transparent animation that feels impossible to get elsewhere.

---

## 9. Appendix — References To Surface In Each Spike

- **T11:** chroma keying, despill, trimap matting, video object segmentation, temporal alpha coherence, prompt compliance testing.
- **T4+:** Animate Anyone, MagicAnimate, MimicMotion, DWPose, Sapiens, DepthAnything, RAFT / FlowFormer, video-to-video pose conditioning.
- **T7:** Wan-Alpha, TransPixeler, LayerFlow, LoRA / DoRA, Alpha-VAE, synthetic RGBA video data generation.
- **T5:** particle systems, 2D motion fields, differentiable warping, alpha-preserving compositing, procedural wind/turbulence.
- **T3:** FILM, RIFE, EMA-VFI, alpha-aware inbetweening, sparse keyframe editing.
- **T8:** closed-form matting, KNN matting, Robust Video Matting, SAM-style segmentation, optical-flow-guided mask smoothing.

Each spike should preserve prompts, seeds, source videos, intermediate masks, final exports, failures, and scores. Today's failed artifact may be tomorrow's training example.

---

**End of R&D agenda.**
