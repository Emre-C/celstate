# Transparent Animation R&D Spike

> **Status:** source of truth for the next transparent-animation R&D spike.
> **Intent:** preserve only the durable context, lessons, decisions, and next steps needed to build.
> **Replaces for strategy purposes:** the older transparent-animation strategy docs. Keep operational runbooks and prompt fixtures only where they are directly useful.

---

## 1. Enduring Background Context

Celstate's proven product is transparent still assets: logos, icons, characters, stickers, overlays. The animation opportunity is the same promise with motion: short transparent assets that creators can drop directly into OBS, editors, streams, and social video without rotoscoping, chroma-key cleanup, or manual compositing.

The existing animation worker proves useful plumbing, but not the real product. It has request lifecycle, Convex storage, worker execution, FFmpeg alpha exports, and decode-and-verify checks. Its renderer is only a transparent still moved deterministically over time. That is not enough: it creates motion, but not animation with independent components, personality, or authored secondary motion.

Transparent video is still technically hard because alpha is not recoverable from arbitrary RGB video. A single opaque pixel does not identify foreground color plus opacity. The still-image white/black trick works because the same image can be regenerated on two backgrounds; the same assumption does not hold for generative video, where a model can change pose, timing, lighting, particles, or camera path between runs.

The market will make individual video engines increasingly replaceable. Native RGBA models, prompt-driven video providers, matting models, segmentation models, motion-transfer systems, and background-removal APIs will all improve. Celstate's durable opportunity is the layer that turns those engines into production-grade transparent motion assets.

The existing prompt benchmark lives in [`docs/implementation/WAN-ALPHA-PHASE1-PROMPTS.md`](../implementation/WAN-ALPHA-PHASE1-PROMPTS.md). Treat it as a useful prompt bank and scoring fixture, not as the strategy. The prompts can be reused or adapted for chroma-background, native-RGBA, and alpha-refinement experiments.

---

## 2. Enduring Lessons Learned

1. **A wrapper around one model is not a moat.** Calling Wan-Alpha, Veo, Runway, Kling, Sora, or any future RGBA model is not defensible by itself.

2. **The moat is the transparent-video production layer.** Prompt contracts, adaptive background selection, matte extraction, temporal alpha refinement, despill, artifact scoring, export QA, and retained failure data can compound into proprietary know-how, datasets, and eventually model weights.

3. **Limited-but-magical beats broad-but-mediocre.** A narrow workflow that produces one astonishing transparent mascot animation is more valuable than generic support for many timid animations.

4. **Single-color keying is not exact alpha recovery, but it may be a useful data path.** Prompt-driven video models can be asked to isolate a subject on a forbidden chroma color. That will fail sometimes, but failures are measurable and can train or guide a refinement stack.

5. **Dual-background video matting is not a pillar.** Same prompt plus same seed on two backgrounds does not guarantee the same performance. Use it only as a negative control unless a provider proves unusually deterministic.

6. **Per-frame image generation is the wrong economic shape.** Image generation should produce references or sparse keyframes, not every video frame.

7. **Humanoid-first is acceptable.** If the first magical workflow only works for mascot-like humanoid characters, that is a strong wedge, not a failure.

8. **Secondary motion is part of perceived magic.** Leaves, particles, glow, cloth, hair, smoke, and wind must move with intent. A single rigid layer sliding around is not competitive.

9. **QA must measure the promise, not the plumbing.** Alpha exists is not enough. We need alpha usability, temporal coherence, edge spill, identity stability, internal motion, secondary-motion coupling, and editor compatibility. Hardcoded passing metrics are forbidden.

10. **Failures are training assets.** Every prompt, seed, source video, intermediate mask, alpha matte, export, score, and failure reason should be retained. Today's bad artifact is tomorrow's dataset row.

---

## 3. Decisions Made

### 3.1 First moat bet

Build the **Celstate Alpha Compiler** first.

The Alpha Compiler is the pipeline, evaluator, and eventually learned model that converts generated motion into production-usable RGBA assets.

```text
generated RGB/native-RGBA/chroma video
  + prompt and reference context
  + rough segmentation/chroma/native alpha
  + temporal signals such as optical flow
  -> refined foreground RGB
  -> stable alpha video
  -> confidence/artifact report
  -> WebM/MOV/APNG/frame exports
```

This is the highest-leverage IP direction because it remains useful no matter which upstream video model wins.

### 3.2 First product-facing showcase

Use a constrained, ambitious mascot workflow as the showcase:

> A humanoid mascot crosses a horizontal transparent canvas, turns back with personality, and wind-blown leaves or particles move coherently around them, exported as OBS-ready alpha video.

This is not the whole product. It is the benchmark that proves the Alpha Compiler can support motion that feels authored and impossible to get from a generic background-removal tool.

### 3.3 First experimental path

Start with **adaptive chroma generated video plus matting/refinement baselines** because it is the fastest way to generate hard artifacts and failure data.

The first two prompt-only Veo attempts showed the same failure pattern: the model converted the requested flat color field into a lit studio backdrop/floor gradient. That means the next upstream source mode is **image-anchored video**, not more blind key-color retries.

Concretely, the next run should be simple: create one still reference frame or ingredient image with the mascot on an exact flat chroma color plate, verify/correct the still before video generation, then use Veo 3.1 image-to-video / reference-image generation with the `MS-01` motion prompt. Chroma-key that source video locally and compare the raw key against refinement attempts.

Do **not** prompt the video model for a transparent background. The source prompt should describe only the foreground action plus the flat key-color background. Transparency is produced later by the local harness.

Key color is an experiment variable, not a settled truth. Pure chroma green `#00FF00` has a familiar green-screen prior and FFmpeg can key it cleanly, but the first green run produced a studio backdrop. A non-natural candidate such as pure magenta `#FF00FF` or electric violet `#7F00FF` is equally valid for the image-anchored run as long as that exact color is recorded in `create-run --key-color` and excluded from all foreground details.

Prompt-only text-to-video is now a control path. It remains useful evidence, but the next source contract should be anchored by a still frame because Veo 3.1 officially supports image-based direction/reference images, and a reference frame gives the model a concrete composition and background contract to preserve.

This does **not** mean chroma keying is the long-term product. It is the fastest experimental input stream for the Alpha Compiler.

### 3.4 What not to build first

- Do not build a Wan-Alpha wrapper as the core product.
- Do not train a full RGBA video generator from scratch yet.
- Do not broaden into every animation use case before one magical constrained workflow works.
- Do not extend the v1 still-plus-translation renderer except as a fallback or control.
- Do not rewrite production worker architecture during the spike. Use a throwaway harness.

### 3.5 Legacy document handling

The older strategy docs have been archived under `docs/archive/transparent-animation/`.
Keep the prompt bank until it is migrated into the spike harness.

Keep as operational or fixture material for now:

- `docs/runbooks/ANIMATION-WORKER.md` — useful for current worker operations only.
- `docs/implementation/WAN-ALPHA-PHASE1-PROMPTS.md` — useful prompt benchmark until migrated.
- `docs/implementation/TRANSPARENT-BACKGROUND-QA.md` — still-image QA remains relevant background.

---

## 4. Spike Objective

Run a focused R&D spike whose output is not a polished product, but a defensible technical verdict and artifact corpus.

### Goal

Determine whether Celstate can build a proprietary Alpha Compiler layer that visibly improves generated transparent animation outputs beyond commodity chroma keying, segmentation, and matting baselines.

### Inputs

- First pass: one `MS-01` mascot traversal source video from Veo 3.1, generated from a still reference frame on a flat chroma background.
- Still reference frame or ingredient image used to anchor the mascot, composition, and exact key-color plate.
- Prompt text that explicitly forbids the key color anywhere except the flat background color field.
- Provider metadata for that one clip: model, seed if available, settings, cost, latency, and raw output.
- Later expansion only after the first run creates useful artifacts: prompts from `WAN-ALPHA-PHASE1-PROMPTS.md`, additional upstream engines, and optional native RGBA outputs.

### Outputs

- Original generated videos.
- Chroma-key baseline alpha outputs.
- Off-the-shelf segmentation/matting baseline outputs.
- One Celstate-improved alpha/refinement output.
- WebM/MOV/APNG/frame exports for representative outputs.
- Scoring table and failure taxonomy.
- Recommendation: continue, narrow, pivot, or stop.

### Success condition

The spike succeeds if it identifies and demonstrates a proprietary improvement path, not if every prompt passes.

A good result looks like:

- baseline outputs fail in recognizable ways;
- our first Alpha Compiler layer improves at least one critical failure class;
- artifacts and scores show where a learned model or deeper pipeline would compound;
- the mascot showcase becomes plausible enough to justify the next R&D cycle.

### Stop condition

Stop or pivot if:

- commodity tools already solve the target quality bar with no Celstate-specific layer;
- generated videos cannot preserve useful subject identity for the mascot wedge;
- alpha failures are dominated by upstream generation failures that refinement cannot repair;
- export compatibility blocks practical use even with good alpha frames.

---

## 5. Immediate Next Steps

### Step 1 — Build a throwaway spike harness

Do not wire this into the production animation worker. Create a local harness that can run prompts, store artifacts, run baselines, score outputs, and summarize failures.

Minimum artifact layout:

```text
tmp/transparent-animation-spike/
  runs/<run-id>/
    input.json
    events.ndjson
    pipeline-state.json
    reference.png
    source.mp4
    source-preview.png
    logs/
    chroma-baseline/
      alpha.mp4
      foreground.mov
      report.json
    matting-baseline/
      alpha.mp4
      foreground.mov
      report.json
    celstate-alpha-v0/
      alpha.mp4
      foreground.mov
      webm.webm
      prores.mov
      apng.png
      report.json
    scores.json
```

Local harness entrypoint:

```bash
pnpm transparent-animation-spike init
pnpm transparent-animation-spike list-prompts --verbose --source-mode image-to-video --key-color '#ff00ff' # copy the MS-01 image-to-video chroma prompt into Veo 3.1
pnpm transparent-animation-spike create-run --prompt-id MS-01 --provider google --model veo-3.1 --source-mode image-to-video --key-color '#ff00ff' --reference path/to/reference-frame.png
pnpm transparent-animation-spike attach-source --run-id <run-id> --source path/to/veo-output.mp4
pnpm transparent-animation-spike process-run --run-id <run-id>
pnpm transparent-animation-spike status --run-id <run-id>
pnpm transparent-animation-spike ingest-matting --run-id <run-id> --foreground path/to/foreground.mov --alpha path/to/alpha.mp4 --tool <tool-name>
pnpm transparent-animation-spike score --run-id <run-id> --stage chroma-baseline --alpha-usability 1 --temporal-coherence 1 --edge-spill-halo 1 --identity-stability 1 --internal-motion 1 --secondary-motion-coupling 1 --prompt-compliance 1 --editor-compatibility 1 --overall-awe 1 --failure <reason> --notes "..."
pnpm transparent-animation-spike summary
```

Durability and diagnosis requirements for the harness:

- `process-run` must be resumable: it skips completed stages by default, reruns failed or incomplete stages, and accepts `--force` to overwrite completed artifacts.
- `reference-ingest` and `source-ingest` must be durable steps: the reference frame and generated source video are copied into the run and recorded in `input.json` before any processing happens.
- Every run must persist `pipeline-state.json` with per-step status, timestamps, durations, outputs, and the latest error.
- Every run must persist `events.ndjson` as an append-only timeline.
- Every FFmpeg/FFprobe invocation must write a JSON command log under `logs/` with args, stdout, stderr, duration, and success/failure.
- `status --run-id <run-id>` must be sufficient to diagnose the last failed step without inspecting code.

### Step 2 — Build the reference-frame source contract

Do not spend another Veo generation on text-only chroma retries. First create one still reference frame for `MS-01`:

- horizontal 16:9 frame;
- mascot and leaves/particles visible enough for Veo to preserve the intended subject/style;
- background is one exact flat key color plate, with no floor, gradient, shadow, vignette, texture, text, or logo;
- the key color does not appear in the mascot, edge details, motion blur candidates, leaves, particles, glow, or reflections.

If the still image generator produces a studio backdrop or gradient, correct/compose the still locally before using it as a video reference. The reference frame is allowed to be manual or generated; what matters is that the file handed to Veo has the exact source contract.

### Step 3 — Run the one-prompt flagship first

Do not begin with the full prompt bank. Start with one source clip:

- prompt ID `MS-01` from the local harness;
- provider/model recorded as Google Veo 3.1;
- source mode recorded as image-to-video or ingredients-to-video;
- reference image stored as `reference.png`;
- flat chroma background requested in the prompt and shown in the reference image;
- key color forbidden everywhere except the flat background color field.

Only after the first mascot run creates useful failures should the spike expand to selected cases from the existing prompt bank. The broader bank is a benchmark expansion, not the first experiment.

### Step 4 — Generate source videos

Generate the first source video in Veo 3.1 using `reference.png` plus the `MS-01` image-to-video chroma prompt. Capture provider, model, seed if available, settings, prompt text, cost, latency, raw output, and whether the reference was used as first frame or a reference/ingredient image.

### Step 5 — Run commodity baselines

Run at least:

- simple adaptive chroma key;
- segmentation + matte refinement baseline;
- temporal smoothing baseline;
- native-RGBA baseline if readily available.

These baselines define what is already commodity.

### Step 6 — Score brutally

Score each output on:

- alpha usability on arbitrary backgrounds;
- temporal flicker or matte breathing;
- edge spill/halo;
- subject identity stability;
- internal motion;
- secondary-motion coupling;
- prompt compliance;
- editor/OBS compatibility;
- overall awe.

Manual scoring is acceptable. Inflated scoring is not.

### Step 7 — Build one proprietary improvement

Choose the improvement after seeing failures. Expected candidates:

1. **Flow-guided temporal alpha stabilizer** if flicker is the dominant failure.
2. **Despill + edge alpha refiner** if halos/spill dominate.
3. **Mask-to-matte refiner** if baselines are too binary.
4. **Adaptive key-color selector + compliance evaluator** if prompt/key contamination dominates.
5. **Synthetic RGBA training-data generator** if the best next move is a learned alpha refiner.

The likely first learned-model target is narrow:

```text
RGB video + rough mask/chroma matte + temporal features -> refined alpha + confidence
```

### Step 8 — Decide the next R&D cycle

At the end, choose one:

- **Continue Alpha Compiler:** build/train the first reusable alpha-refinement model.
- **Narrow to mascot wedge:** focus only on humanoid/mascot clips with secondary motion.
- **Shift to native RGBA benchmarking:** if native RGBA quality is close but needs QA/export hardening.
- **Pivot to procedural/layered animation:** if generated video cannot preserve identity or useful motion.
- **Stop animation R&D:** if no path clears the quality bar without becoming a commodity wrapper.

---

## 6. The Working Thesis

Celstate should not try to own video generation broadly. Celstate should own the conversion of generated motion into trustworthy transparent motion assets.

If we can build the best alpha compiler for creator-grade generated animation, every upstream model improvement helps us. If we only wrap one upstream model, every upstream improvement commoditizes us.
