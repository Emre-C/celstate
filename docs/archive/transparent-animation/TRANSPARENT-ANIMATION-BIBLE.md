# Transparent Animation Bible

> **Status:** Authoritative. Supersedes [`TRANSPARENT-ANIMATION-GENERATION.md`](./TRANSPARENT-ANIMATION-GENERATION.md), which now describes the deprecated **v1** "still + procedural translate" architecture. Do not extend v1. Read this entire document before writing animation code.
>
> **Owner:** Founder / lead engineer.
> **Reviewed:** 2026-05-10.
> **Reading order for new contributors:** §1 → §2 → §5 → §7 → §8 → rest as needed.

---

## Table of Contents

1. [Purpose of This Document](#1-purpose-of-this-document)
2. [The Vision](#2-the-vision)
3. [Why Transparent Animation Is Hard (Background)](#3-why-transparent-animation-is-hard-background)
4. [Technology Landscape, 2026 Snapshot](#4-technology-landscape-2026-snapshot)
5. [Current State Of The Codebase](#5-current-state-of-the-codebase)
6. [Why v1 Cannot Reach The Vision (The Math)](#6-why-v1-cannot-reach-the-vision-the-math)
7. [Architectural Decision For v2](#7-architectural-decision-for-v2)
8. [Roadmap](#8-roadmap)
9. [Decision Gates And Pivot Triggers](#9-decision-gates-and-pivot-triggers)
10. [Cost & Risk Model](#10-cost--risk-model)
11. [Quality Bar & Test Prompts](#11-quality-bar--test-prompts)
12. [Glossary](#12-glossary)
13. [Open Questions](#13-open-questions)
14. [Change Log](#14-change-log)

---

## 1. Purpose Of This Document

This is the single source of truth for transparent-animation strategy at Celstate. It exists because we already built the wrong thing once. To prevent that recurring:

- **Every animation-related PR must be defensible against this doc.** If a change conflicts with the architecture or the roadmap, this doc must be updated *first*, with reasoning, and approved by the owner.
- **Every kill-gate (§9) must be respected.** Failing a gate means stop — not "iterate harder." We do not invest production effort ahead of validated quality.
- **Every claim about "what works" must be empirically grounded.** No more product polish on unproven engines.

If you are an AI agent reading this: do not propose code changes to the animation worker, schema, or `/app/animations` UI without first re-reading §5 (current state) and §8 (current roadmap phase). Most changes you might propose are forbidden by §7.

---

## 2. The Vision

Celstate produces **transparent visual assets that creators drop straight into OBS, video editors, and live streams.** Stills (logos, icons, characters, stickers) are the proven product. The next frontier is **animation**: the same on-brand transparent assets, but *alive*.

Concretely, a successful animation product means:

- A creator types a prompt or uploads a reference, picks a use case, and ~minutes later receives a short transparent video clip.
- The clip has **real internal motion**: a forest spirit's leaves flutter independently, glow pulses, particles drift, a mascot blinks, a logo reveals with a sting that breathes — not a static asset translating across the canvas.
- **Alpha is stable frame-to-frame.** No haloing, no chromatic flicker around edges, no breathing matte.
- **Subject identity is stable.** The character at frame 60 is recognisably the same character as at frame 0.
- The asset **drops into OBS / Premiere / Final Cut / DaVinci** without keying, rotoscoping, or chroma-key cleanup. WebM (VP9 + alpha) and MOV (ProRes 4444) cover those workflows.
- The 7 launched use cases ship with sensible motion priors: `stream_alert`, `stinger_transition`, `mascot_reaction`, `logo_sting`, `lower_third`, `video_callout`, `creator_overlay`. (See [`schema.ts`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/src/convex/schema.ts#L92-L127) for the canonical list.)

What "vibrant" means in practice (the bar v1 fails):

| Required visual phenomenon              | v1 (current)      | Vision target |
| --------------------------------------- | ----------------- | ------------- |
| Independent component motion            | Impossible        | Required      |
| Semi-transparent FX (smoke, glow, hair) | Single still only | Required      |
| Frame-to-frame alpha stability          | Trivially yes (same matte each frame) | Required, harder |
| Character identity over time            | Trivially yes (same PNG) | Required |
| Plays in OBS / Premiere with alpha      | Yes               | Yes |
| Believable as "real animation"          | **No**            | **Required** |

The product is dead-on-arrival without the last row.

---

## 3. Why Transparent Animation Is Hard (Background)

Three independent hard problems stack on top of each other.

### 3.1 Alpha is fundamentally underdetermined from RGB

Given one opaque RGB pixel, you cannot recover its alpha. A grey pixel could be opaque grey, 50% white over black, 25% red over a complementary background, or any of an infinite set of `(rgb_foreground, alpha)` decompositions. This is why our **still-image** pipeline uses two passes (white background + black background): the difference uniquely identifies alpha. (See the math in [`image-generation.md`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/product/image-generation.md).)

That trick **does not generalise to video**, because there is no model that will regenerate 30+ frames of identical content on two different backgrounds with sub-pixel temporal alignment. Frame-by-frame matting has the same ambiguity, plus *temporal* ambiguity: a flickering matte breaks the illusion immediately even if each individual frame is plausible.

### 3.2 General-purpose video models output opaque RGB

Veo, Runway Gen-4.5, Sora-class models, Kling, Pika, Luma — all current commercial APIs (as of 2026-05-10) generate **opaque** video by default. Runway exposes a legacy "Remove Background" workflow that is essentially green-screen matting; their own help docs warn against busy backgrounds, motion, cuts, and longer clips — i.e. exactly the inputs we want.

Therefore the path "use a generic video model + matte the alpha out" is **strictly limited to opaque-foreground-on-clean-background subjects**. It cannot produce semi-transparent magic effects, glow, smoke, fire, particles, fine hair, motion blur — most of what makes a stylized brand asset feel "vibrant."

### 3.3 RGBA video data is scarce

Training a model to generate RGBA video natively requires RGBA video training data, which barely exists at scale. Every research paper in this space (TransPixeler, LayerFlow, TransAnimate, Wan-Alpha) spends most of its method section describing how the authors bootstrapped enough RGBA data via matting/inpainting/copy-paste tricks. Until late 2025 this was the bottleneck. As of 2026 it is no longer the bottleneck (see §4).

### 3.4 Why the v1 team got this wrong

The v1 architecture was written assuming "alpha video is impossible, so we'll generate one perfect transparent still and animate it procedurally." That was a defensible 2024 assumption. It is not a defensible 2026 assumption. The field moved; the doc didn't.

---

## 4. Technology Landscape, 2026 Snapshot

This section is the empirical foundation for §7 (architectural decision). All citations are real and verified at time of writing. Refresh quarterly — the field is moving fast.

### 4.1 Native RGBA video generation (the unlock)

**Wan-Alpha v2.0** — *the most credible production path today.*

- **Status:** CVPR 2026 Highlight (accepted Feb 2026). Open weights, open VAE, open training data, open ComfyUI integration as of Mar 2026.
- **Architecture:** Wan2.1-T2V-14B base + LightX2V acceleration + Alpha-VAE LoRA + DoRA-tuned diffusion transformer. Generates 81 frames @ 16 FPS in **4 sampling steps**.
- **Demonstrated on:** semi-transparent objects (lace, ink, fabric), glow, smoke, hair strands, animals, stylized FX. These are the headline showcase, not the limitations.
- **Roadmap:** Image-to-Video (I2V) variant on the published TODO list. This is the variant we ultimately want (so users get *their* generated character animated, not a fresh one each call).
- **Repo:** <https://github.com/WeChatCV/Wan-Alpha>
- **Paper:** <https://arxiv.org/abs/2509.24979>
- **Why it matters for us:** native RGBA, open license, runnable on commodity H100s or via API providers (fal.ai, Replicate are likely to host it). Solves problem 3.2 directly.

**TransPixeler** — *secondary candidate, more mature integration.*

- CVPR 2025. Integrates with Wan2.1 base. Joint RGB+alpha tokens with LoRA fine-tuning.
- Older than Wan-Alpha but more battle-tested. Useful as a fallback if Wan-Alpha v2.0 has unforeseen production issues.
- Repo: <https://github.com/wileewang/TransPixeler>

**LayerFlow** — *the "decompose into layers" path.*

- SIGGRAPH 2025. Generates `(transparent foreground, clean background, blended scene)` jointly from per-layer prompts.
- Useful when we want to give creators *multi-layer* output (character on one layer, FX on another) so they can composite differently per platform. Not phase-1 priority but valuable for power-users.
- Project page: <https://sihuiji.github.io/LayerFlow-Page/>

**TransAnimate, Layer-Animate, TransVDM, ILDiff, AlphaVAE, LayerDiffuse** — older or more specialised; logged for completeness; not first-line candidates.

### 4.2 Opaque-video + matting (the dead end for our use case)

- **Veo 3.1 (Google):** No native alpha. Image / video / mask conditioning, no RGBA output.
- **Runway Gen-4.5:** No native alpha output via API. Legacy Remove Background workflow has explicit limitations against the content we generate.
- **SAM 2 / RobustVideoMatting / BiRefNet:** Excellent at *segmenting* opaque foregrounds; cannot recover semi-transparent alpha. Useful as a *post-process refinement* on Wan-Alpha output (e.g. cleaning up edge spill), not as a primary path.
- **Pixa video background removal:** Same matting limitation. Good for "isolate a person from a video shot," bad for "extract glowing magic wisps from a fantasy scene."

**Conclusion:** Opaque-video + matting is permanently disqualified as the primary engine. It can have a small auxiliary role in post-processing.

### 4.3 Layered procedural compositing (the backup)

If §4.1 fails its kill-gate, the credible fallback is:

1. Generate transparent **layers** as stills (character, FX, particles, glow) using our existing image pipeline.
2. Animate each layer independently using deterministic motion priors *plus* small puppet-warp / 2D mesh deformation / particle systems (think Live2D, Spine, After Effects-style rigging — but generated, not hand-rigged).
3. Composite with alpha blending in our worker.

This is more brittle (each layer is hand-tuned per use case) and less "magical" than native RGBA video, but it is *fully* under our control and 100% deterministic. It is the survival path if the open-source RGBA stack disappoints in production.

### 4.4 What is NOT a viable path

For agent clarity — these have been investigated and rejected:

- "Just animate the still better with more ffmpeg filters." No. Whole-image transforms cannot create independent component motion. Period.
- "Use a generic video model and trust matting." No. See §3.2 + §4.2.
- "Train our own RGBA video model from scratch." No. Order-of-magnitude over budget. Use Wan-Alpha or LayerFlow.
- "Generate every frame as a transparent still with the existing 2-pass pipeline, then sequence them." No. Two passes per frame at ~30+ frames is cost-prohibitive *and* the model will not produce temporally consistent identity. Tried mentally; mathematically a non-starter.

---

## 5. Current State Of The Codebase

This section is a forensic snapshot. All claims are verified in code at the cited line ranges. If you change the code, update this section in the same PR.

### 5.1 The salvageable shell (KEEP — high value)

These pieces are infrastructure that any v2 renderer will need. Do not delete.

| Piece                                | Location | Notes |
| ------------------------------------ | -------- | ----- |
| Convex `animationGenerations` table  | [`schema.ts:92-127`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/src/convex/schema.ts#L92-L127) | Status enum and `veoOperationName` / `veoOutputGcsUri` fields are usable as-is for any async video provider, not just Veo. Rename later, don't migrate now. |
| Job lifecycle mutations / queries    | [`animationGenerations.ts`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/src/convex/animationGenerations.ts) | Claim / fail / complete flow is provider-agnostic. |
| Run helper                           | [`animationGenerationRun.ts`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/src/convex/lib/animationGenerationRun.ts) | Status transitions and credit handling. |
| Use-case prompt scaffolding          | [`animationPrompts.ts`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/src/convex/lib/animationPrompts.ts) | Use-case → prompt-shaping is reusable; the *content* of the prompts will change to be motion-aware. |
| Worker shell (claim, flight recorder, FFmpeg export, storage upload) | [`animation-worker.ts`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/animation-worker.ts) | The orchestration is fine. The renderer (§5.2) is not. |
| FFmpeg alpha export commands         | [`animation-worker.ts:632-696`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/animation-worker.ts#L632-L696) | VP9 `yuva420p`, ProRes 4444 `yuva444p10le`, APNG, frame ZIP. All production-grade and reusable. |
| Convex storage upload + manifest     | [`animation-worker.ts:720-740`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/animation-worker.ts#L720-L740) | Reusable. |
| `/app/animations` UI                 | [`+page.svelte`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/src/routes/%28app%29/app/animations/+page.svelte) | Submission form, list, status display. Mostly reusable. UX language must change to stop calling v1 output "animation" (see §8 Phase 0). |
| Doppler / Convex worker secret wiring | [`docs/runbooks/SECRETS-MANAGEMENT.md`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/runbooks/SECRETS-MANAGEMENT.md) | Already correct. |

### 5.2 The dead renderer (REPLACE — zero salvage)

| Piece                       | Location | Why it's dead |
| --------------------------- | -------- | ------------- |
| `motionOffset()`            | [`animation-worker.ts:552-578`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/animation-worker.ts#L552-L578) | Returns `{x, y}` translation per frame from sin/cos of `t`. There is no other motion source. Deleting this function deletes the entire animation logic. |
| `renderTransparentFrames()` | [`animation-worker.ts:580-618`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/animation-worker.ts#L580-L618) | Composites the same `referencePng` over a transparent canvas at `motionOffset()` for each frame. Mathematically incapable of internal motion. |
| Reference candidate builder | [`animation-worker.ts:272-341`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/animation-worker.ts#L272-L341) | Useful for stills, **not for animation**. Will be moved to a `transparent-still-generator` module if v1 fallback is preserved. |
| White/black retry logic     | [`animation-worker.ts:~400-540`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/animation-worker.ts#L400-L540) | Same as above — relevant to still generation only. |
| Use-case-specific motion presets | [`animation-worker.ts:562-577`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/animation-worker.ts#L562-L577) | Tied to whole-image translation. Replace with motion-aware *prompt scaffolding* in v2, not transform code. |

### 5.3 QA system blind spots (REPLACE — actively misleading)

The v1 QA system exists to **lie convincingly about v1 output**. This is actively dangerous because it produces "PASS" verdicts on broken animations.

| Issue | Location | Impact |
| ----- | -------- | ------ |
| `componentStability: 1` is hardcoded | [`animation-worker.ts:753`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/animation-worker.ts#L753) | The metric that *would* detect "fake whole-layer motion" is forced to its passing value. The system cannot fail v1 even in principle. |
| `edgeSpill: 0` is hardcoded | [`animation-worker.ts:756`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/animation-worker.ts#L756) | Same shape: a metric that should be measured is forged. |
| Pass criteria check only alpha coverage and border transparency | [`animation-worker.ts:709-718`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/animation-worker.ts#L709-L718) | Validates plumbing (alpha exists, edges are clean), not animation quality. |
| No motion metrics: no inter-frame foreground diff, no component-tracking, no flicker score, no identity-drift, no loop-seam, no rigid-translation detector | n/a | Whole class of failure modes is invisible to QA. |

**Mandate for v2:** before any v2 renderer ships, the QA module must be rewritten with the metrics in §11. A renderer is allowed to fail QA. Hardcoding metrics to "pass" is forbidden by this doc.

### 5.4 Documentation that misleads

- [`TRANSPARENT-ANIMATION-GENERATION.md`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/product/TRANSPARENT-ANIMATION-GENERATION.md) defends the v1 architecture and explicitly puts the right approach ("alpha from generative video") *out of scope*. After v2 lands, this doc will be marked deprecated; until then, leave it but link to this bible from its top.
- [`docs/runbooks/ANIMATION-WORKER.md`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/runbooks/ANIMATION-WORKER.md) describes the v1 operational flow. Will need parallel v2 sections during phased rollout.
- [`TRANSPARENT-BACKGROUND-QA.md`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/implementation/TRANSPARENT-BACKGROUND-QA.md) covers *still* QA, which remains correct. Keep.

### 5.5 Honest summary

```diagram
╭───────────────────────────────────────────────────────╮
│ KEEP (job lifecycle, storage, FFmpeg, UI shell)       │  ~30% of code
├───────────────────────────────────────────────────────┤
│ REPLACE (renderer, QA, use-case motion presets, doc)  │  ~70% of code
╰───────────────────────────────────────────────────────╯
```

Roughly 30% of the existing code survives v2. That is not a disaster — the salvageable 30% is the boring, correct infrastructure. The 70% being deleted is the part that was attempting to solve the wrong problem.

---

## 6. Why v1 Cannot Reach The Vision (The Math)

This section exists so that no one — agent or human — re-litigates this in the future.

**v1's final frame at time t:**

```
frame_t(x, y) = referencePng(x - dx_t, y - dy_t)
```

…where `(dx_t, dy_t)` is a deterministic offset from `motionOffset(useCase, t)`.

The pixel value at `(x, y)` in `frame_t` depends on **only one input** that varies with `t`: the offset. Therefore:

- Every visible pixel at every frame is a translated copy of the same reference pixel. No new visual information enters the system as `t` advances.
- Two pixels that were neighbours in the reference are still neighbours in every frame. There is no way for "the leaves" to move relative to "the character," because they are fused in the reference.
- All visible motion is **rigid 2D translation of the entire RGBA image**. By construction.

The only way to get independent component motion under this architecture is to introduce **multiple reference images** (one per moving component) and composite them at independent offsets — i.e. become §4.3 (layered procedural). v1 does not do this. Extending v1 to do this is essentially the §4.3 rewrite, not a v1 patch.

**Therefore:** no amount of prompt engineering, ffmpeg filters, easing curves, motion blur, or use-case-specific tuning can produce internal motion from this renderer. The premise is broken.

The QA hardcoding in §5.3 was added because *the team noticed* the renderer cannot pass real motion checks, and rather than fix the renderer, they made the checks unfailable. That is a critical retrospective lesson: **never ship a metric whose value is set rather than measured.**

---

## 7. Architectural Decision For v2

### 7.1 The decision

**v2's primary engine is native RGBA video generation, with Wan-Alpha v2.0 as the lead candidate.** Specifically:

```diagram
╭──────────────────────────────────────╮
│ User submits prompt + use case + ref │
╰──────────────────┬───────────────────╯
                   ▼
╭──────────────────────────────────────╮
│ Convex animationGenerations row      │  (KEEP from v1)
╰──────────────────┬───────────────────╯
                   ▼
╭──────────────────────────────────────╮
│ Worker claims job                    │  (KEEP from v1)
╰──────────────────┬───────────────────╯
                   ▼
╭──────────────────────────────────────╮
│ Build motion-aware prompt            │  (NEW — §8 Phase 2)
╰──────────────────┬───────────────────╯
                   ▼
╭──────────────────────────────────────╮
│ Submit to RGBA video provider        │  (NEW)
│  - Wan-Alpha v2.0 (primary)          │
│  - via fal.ai / Replicate / self-host│
╰──────────────────┬───────────────────╯
                   ▼
╭──────────────────────────────────────╮
│ Poll for completion (long-running)   │  (NEW; veoOperationName field reused)
╰──────────────────┬───────────────────╯
                   ▼
╭──────────────────────────────────────╮
│ Download RGBA frames                 │  (NEW)
╰──────────────────┬───────────────────╯
                   ▼
╭──────────────────────────────────────╮
│ Optional: matting refinement pass    │  (NEW, optional)
│  e.g. SAM2 / RVM for edge cleanup    │
╰──────────────────┬───────────────────╯
                   ▼
╭──────────────────────────────────────╮
│ Motion-aware QA (§11)                │  (REPLACE v1 QA)
╰──────────────────┬───────────────────╯
                   ▼
╭──────────────────────────────────────╮
│ FFmpeg alpha export                  │  (KEEP from v1)
│  WebM VP9, MOV ProRes 4444, APNG, ZIP│
╰──────────────────┬───────────────────╯
                   ▼
╭──────────────────────────────────────╮
│ Convex storage upload + UI           │  (KEEP from v1)
╰──────────────────────────────────────╯
```

### 7.2 The fallback

If §7.1 fails its Phase 1 kill-gate (§9.1), the fallback is **layered procedural compositing** (§4.3). Specifically:

- Generate N transparent still layers using the existing image pipeline (proven).
- Animate each layer with one of: deterministic motion preset, 2D puppet warp, particle system.
- Composite with proper alpha blending in the worker.

This is the survival plan, not the preferred plan. It produces less "magical" output but is fully under our control.

### 7.3 The forbidden paths

- Building or extending the v1 still-translate renderer for production use.
- Using opaque-video + matting (Veo / Runway / Sora + SAM/RVM) as the **primary** engine. Allowed only as a refinement pass on top of native RGBA output.
- Training our own RGBA video model from scratch.
- Shipping any animation feature whose QA metrics are hardcoded rather than measured.
- Calling v1 output "animation" in any user-facing copy.

### 7.4 The renaming

To prevent future confusion:

- v1's renderer becomes `transparentStickerFallback` (or similar) and is either deleted or relegated to a clearly-labelled "static transparent sticker" product surface. It is **not** the animation product.
- "Animation" in `/app/animations` means *v2 output only*.
- Schema field `veoOperationName` becomes provider-agnostic semantically (we keep the name to avoid migration; comment it in code).

---

## 8. Roadmap

Phased. Each phase has a goal, a definition of done, and a kill-gate. **Do not skip phases.** Do not start phase N+1 until phase N's gate is passed.

### Phase 0 — Freeze (this week)

**Goal:** stop bleeding before building.

- [ ] Mark [`TRANSPARENT-ANIMATION-GENERATION.md`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/product/TRANSPARENT-ANIMATION-GENERATION.md) as deprecated at top, link to this bible.
- [ ] Mark [`/app/animations`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/src/routes/%28app%29/app/animations/+page.svelte) UI as **beta / experimental** in the surface, OR remove from main nav for paying users. No more credits charged at full rate against v1 output.
- [ ] Disable any v1 marketing copy that promises "real animation."
- [ ] Stop spending paid Gemini calls on v1 debug runs unless explicitly part of a v2 spike.
- [ ] Tag the current main commit as `animation-v1-final` for archaeology.

**Definition of done:** no user, paying or free, can mistake v1 output for the animation product Celstate is building.

**Kill-gate:** none — Phase 0 is entirely safe to do.

### Phase 1 — Kill-spike (2 weeks, capped budget)

**Goal:** answer "is native RGBA video viable for Celstate?" with empirical evidence, not opinion.

Concretely:

1. **Pick a hosting path.** Try in this order: fal.ai or Replicate hosted Wan-Alpha endpoint (cheapest if available); else rented H100 on Runpod / Modal / Lambda; else self-host on GCP A100. Goal is the lowest-friction inference surface, *not* production architecture.
2. **Write a throwaway harness** outside the worker. Plain script. No Convex. No retries. Reads a prompt list, hits the provider, downloads RGBA frames, exports a WebM/MOV via the same FFmpeg commands we already have. Should be ~200 lines.
3. **Run the [Phase 1 prompt set (§11.2)](#112-phase-1-prompt-set)** — 30 prompts spanning the 7 use cases.
4. **Score each output** against the [v2 quality bar (§11.1)](#111-v2-quality-bar). Use a mix of automated metrics (where built) and **honest manual review** by the founder. No hardcoded passes.
5. **Measure cost & latency per clip.** Record: provider $/clip, wall-clock minutes/clip, GB egress/clip, GPU minutes/clip.
6. **Try image-to-video conditioning** if the Wan-Alpha I2V variant is shipped by then; otherwise note as deferred.
7. **In parallel, scope the §4.3 layered fallback** as a thought experiment — sketch the architecture for one use case (e.g. `mascot_reaction`), don't build it. We need this only if Phase 1 fails.

**Definition of done:** a written Phase 1 report with:

- Per-prompt outputs (links / artifact paths).
- Per-prompt score on the §11.1 rubric.
- Cost / latency per clip averaged across the 30 prompts.
- A clear go / no-go recommendation against the §9.1 gate.
- A list of failure modes observed (so we know what v2's QA must catch).

**Kill-gate (§9.1):** see §9.

### Phase 2 — Renderer replacement (4–6 weeks, post-gate)

**Goal:** swap the v1 renderer for the v2 engine inside the existing worker shell, without breaking the surrounding infrastructure.

- [ ] New module `scripts/animation-renderer-v2.ts` (or similar). Implements the §7.1 flow.
- [ ] Replace the call site in `animation-worker.ts` with `renderViaProvider(...)`. Keep the existing claim/flight-recorder/storage upload logic untouched.
- [ ] New `motion-qa.ts` implementing the §11.1 metrics. **No hardcoded passes.** Must be capable of failing v1 output.
- [ ] Add a `renderer: "v1" | "v2"` field on `animationGenerations` and route requests by feature flag (or by request type). Default: v2 for new jobs, v1 retained read-only for historical jobs.
- [ ] Provider polling for long-running generation. Reuse `veoOperationName` field; document the rename intent in a code comment.
- [ ] Schema migration only if Phase 1 reveals a need we can't shoehorn into existing fields.
- [ ] Update `docs/runbooks/ANIMATION-WORKER.md` with v2 ops procedure (env vars, provider auth, expected costs, failure modes).
- [ ] Add e2e test: submit one job per use case, assert export artifacts exist and pass §11.1 motion QA.
- [ ] Update `/app/animations` copy to describe what users actually get from v2.

**Definition of done:** all 7 use cases produce v2 output that passes §11.1 motion QA on at least the curated test prompts. Job lifecycle, billing, and UI behave correctly. `pnpm verify` passes.

**Kill-gate (§9.2):** see §9.

### Phase 3 — Production polish (3–4 weeks)

**Goal:** make v2 a real product, not a research artifact.

- [ ] **Cost optimisation.** Batch where possible, cache where possible, use cheapest viable inference path.
- [ ] **Observability.** Per-job provider latency, cost, queue depth dashboards. PostHog events for submission / completion / failure / motion-QA-fail. Surface in [`growth-observability.md`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/product/growth-observability.md) terms.
- [ ] **Refinement passes.** Optional SAM2 or RVM-style alpha refinement pass for edge cleanup if Phase 1 / 2 testing showed need.
- [ ] **Failure UX.** When a job fails motion QA, refund credit and offer regen with adjusted prompt — don't silently ship a dud.
- [ ] **Rate limiting & abuse prevention.** RGBA generation is expensive; protect with the patterns in [`credit-system-abuse-prevention.md`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/product/credit-system-abuse-prevention.md).
- [ ] **Pricing model.** Set credit cost per animation based on actual measured cost from Phase 1 / 2, with margin. Update [`payments-system.md`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/product/payments-system.md).
- [ ] **OBS / Premiere import smoke tests.** Real human downloads exports and imports them into both. Documents any quirks.

**Definition of done:** v2 is the only animation path, observable, billed correctly, and has run for 100+ real user jobs without major incident.

**Kill-gate:** if real-user motion-QA pass-rate < 80% in week 2 of production, pause new submissions and triage.

### Phase 4 — Vision expansion (after stable Phase 3)

**Goal:** the things we wanted on day 1 but couldn't justify before stability.

- Image-to-Video (use the user's *generated* transparent still as the seed — once Wan-Alpha I2V or equivalent is mature).
- LayerFlow-style multi-layer output (deliver `(character, fx, glow)` as separate transparent files for power users).
- Longer durations (>5s) once cost economics allow.
- Style consistency across a creator's animations (LoRA per brand, conditioned on brand kit).
- Sound design integration (optional — separate track).
- Custom motion priors per use case from creator feedback.

These are **not** Phase 1–3 scope. Adding them earlier delays the ship of the core product.

---

## 9. Decision Gates And Pivot Triggers

Each gate is a hard yes/no. The owner makes the call based on the Phase report.

### 9.1 Phase 1 → Phase 2 gate (the big one)

**Question:** does native RGBA video generation produce Celstate-quality output at viable cost?

**Pass requires ALL of:**

- ≥ **70%** of the 30 Phase 1 prompts produce outputs that score ≥ 4/5 on the §11.1 rubric (with manual review by the owner).
- Per-clip provider cost ≤ **$0.50** (target) or ≤ **$1.00** (acceptable with margin in pricing model).
- Per-clip wall-clock latency ≤ **5 minutes** (target) or ≤ **15 minutes** (acceptable with async UX).
- No fundamental failure mode that we cannot work around (e.g. "can never produce a logo," "always shows watermarks," "license forbids commercial use").

**On pass:** start Phase 2.

**On fail:** go to §9.3 (pivot decision).

### 9.2 Phase 2 → Phase 3 gate

**Question:** can the v2 renderer ship safely behind the existing infrastructure?

**Pass requires ALL of:**

- All 7 use cases pass §11.1 motion QA on a curated test set.
- e2e test passes consistently in CI (3 consecutive runs).
- Schema and worker changes are backward-compatible with v1 historical data (no broken jobs in `animationGenerations`).
- Cost per real job in canary (50 jobs against staging) is within ±25% of Phase 1 estimate.

**On pass:** start Phase 3.

**On fail:** triage. Most likely cause is a new failure mode in production conditions that wasn't seen in the spike. Iterate inside Phase 2; do not regress to v1.

### 9.3 Pivot decision (Phase 1 fails)

If Phase 1 fails the §9.1 gate, the owner picks one of:

1. **Wait & retry in 3 months** with a newer Wan-Alpha version or a successor model. (The field is moving fast — the answer in mid-2026 may not be the answer in late-2026.)
2. **Pivot to layered procedural (§4.3).** Higher engineering cost; lower magic ceiling; full control. Run a Phase 1.5 spike on this path with the same scoring rubric.
3. **Kill the animation product.** Double down on transparent stills, which work. Refund any pending animation credits. Mark `/app/animations` as discontinued. **This is a respectable outcome, not a failure.**

The wrong choice is "polish v1 some more." That option is permanently off the table per this doc.

### 9.4 Refresh trigger

This bible should be re-evaluated quarterly, or immediately on any of:

- A new RGBA video model paper / release that materially shifts the landscape (e.g. Wan-Alpha v3.0, a Veo / Runway alpha-channel API, a new commercial provider).
- Cost shift > 2× in either direction at our chosen provider.
- Real-user motion-QA pass-rate drops below 70% for two consecutive weeks in Phase 3+.

---

## 10. Cost & Risk Model

Rough order-of-magnitude. Replace with real numbers after Phase 1.

### 10.1 Phase 1 spike cost ceiling

| Item                                                    | Estimate |
| ------------------------------------------------------- | -------- |
| Hosted inference (30 prompts × ~$1 each)                | $30–$100 |
| Founder + 1 engineer time, 2 weeks                      | (sunk)   |
| Optional: rented H100 day for self-host smoke test      | $50–$200 |
| **Total**                                               | **< $500** |

If Phase 1 costs more than $500 of paid inference, stop and re-scope.

### 10.2 Per-clip cost projection (post Phase 1)

| Component                                    | Estimate (TBD by Phase 1) |
| -------------------------------------------- | -------------------------- |
| Native RGBA generation (5s clip)             | $0.20–$1.00 |
| Optional matting refinement                  | $0.01–$0.10 |
| FFmpeg encode + storage upload               | < $0.01 |
| Convex / DB                                  | rounding |
| **Total cost-of-goods per clip**             | **$0.20–$1.10** |

This drives credit pricing in Phase 3. Consult [`payments-system.md`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/product/payments-system.md) and [`weekly-credit-drip.md`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/docs/product/weekly-credit-drip.md) when setting prices.

### 10.3 Risk register

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Wan-Alpha v2.0 quality fails §11 rubric | Medium | High | §9.3 pivot; layered procedural backup. |
| Hosted provider doesn't add Wan-Alpha endpoint | Medium | Medium | Self-host on rented H100; longer setup, similar ongoing cost. |
| Per-clip cost > $1.00 | Medium | Medium | Adjust pricing; cap clip duration; batch runs; defer Phase 4. |
| Latency > 15 min per clip | Low–Medium | Medium | Async UX (already supported by job lifecycle); don't promise "instant." |
| Wan-Alpha license restricts commercial use | Low (open-source per repo) | High | Verify in Phase 1; fall back to TransPixeler or layered procedural. |
| Subject identity drift across frames | Medium | High | Use I2V conditioning when available; expose retry/regen UX. |
| Alpha edge instability ("breathing matte") | Medium | High | Refinement pass; or re-tune Wan-Alpha; or fall back. |
| Field moves: better model emerges mid-build | Low | Low | We can swap providers behind the worker abstraction. |

---

## 11. Quality Bar & Test Prompts

### 11.1 v2 quality bar

A v2 output **passes** only if it satisfies all of these. These metrics replace the broken v1 QA in [`animation-worker.ts:709-765`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/scripts/animation-worker.ts#L709-L765).

| Metric | Definition | Pass threshold (Phase 1 manual scoring) | Phase 2 automation target |
| ------ | ---------- | --------------------------------------- | -------------------------- |
| **Internal motion** | Distinct visual components move independently of each other and the canvas | ≥ 4/5 manual score | Inter-frame foreground diff inside fg mask, after subtracting global motion; non-trivial |
| **Alpha temporal stability** | No frame-to-frame haloing, breathing matte, or chromatic flicker around edges | ≥ 4/5 manual score | Per-pixel alpha variance over time within edge band, below threshold |
| **Subject identity stability** | Character / logo at frame N is the same character / logo at frame 0 | ≥ 4/5 manual score | CLIP / DINO embedding similarity between frame 0 and frame N |
| **No rigid-translation masquerade** | Output is not just the same image translated | binary: pass / fail | Whole-image cross-correlation across frames; if max correlation > 0.98 for any large translation, **fail** |
| **OBS / editor compatibility** | Imports cleanly into OBS Browser Source / Media Source AND into Premiere or DaVinci with alpha intact | binary: pass / fail | Decode-and-verify alpha pipeline (already in v1) + manual smoke |
| **Loop seam (where applicable)** | First frame ≈ last frame for use cases that should loop | ≥ 4/5 manual score | First-vs-last L1 distance inside fg mask |
| **Brand palette fidelity** | Colors match the prompt / reference within tolerance | ≥ 4/5 manual score | ΔE color distance from reference, below threshold |

The list deliberately starts with **manual scoring** in Phase 1 — we do not have automated metrics for "internal motion" yet, and we should not pretend we do. Phase 2 builds the automation.

**Hardcoding any of these to pass is forbidden.** If a metric is hard to compute, leave it absent and document the gap. Do not fake it.

### 11.2 Phase 1 prompt set

30 prompts across the 7 use cases. Designed to stress the system with the failure modes that matter. Owner should curate this list before Phase 1 starts; the categories below are the structure, not literal prompts.

| Category | Count | What it tests |
| -------- | ----- | ------------- |
| **Mascot reactions** with hair / fur / cloth | 5 | Fine alpha edges, character identity, subtle motion |
| **Stinger transitions** with particles + glow | 5 | Semi-transparent FX, independent particle motion |
| **Logo stings** with reveal / scale / sparkle | 4 | Subject identity (logo readability), controlled motion |
| **Stream alerts** with text + character + FX | 5 | Multi-component, text legibility under motion |
| **Lower thirds** with subtle motion + text | 4 | Restraint (motion shouldn't break readability) |
| **Video callouts** with arrow / pointer + character | 4 | Directional motion, two distinct components |
| **Creator overlays** with breathing motion | 3 | Subtlety bar — animation should feel alive, not noisy |

Each prompt is run **3 times** (different seeds where supported) to assess variance. Total: 90 generations. At an estimated $1/clip that is ~$90; well within the §10.1 ceiling.

---

## 12. Glossary

| Term | Definition |
| ---- | ---------- |
| **Alpha channel** | Per-pixel transparency value (0 = fully transparent, 255 = fully opaque). The 4th channel in RGBA. |
| **Alpha matte** | The alpha channel viewed as a grayscale image. |
| **Difference matting** | The technique of recovering alpha by comparing two passes of the same subject on different known backgrounds. Works for stills (our existing pipeline). Does **not** generalize to video. |
| **Native RGBA generation** | A video model trained to output 4-channel RGBA frames directly, with alpha jointly learned with RGB. Wan-Alpha, TransPixeler, LayerFlow are examples. |
| **Matting (post-hoc)** | Recovering an alpha channel from already-generated opaque RGB by segmentation. SAM2, RVM, BiRefNet. Limited to opaque foregrounds. |
| **I2V** | Image-to-Video. Conditioning a video model on a starting image so the generated clip is "this image, animated." |
| **T2V** | Text-to-Video. |
| **DiT** | Diffusion Transformer. The architecture family most modern video models use. |
| **VAE** | Variational Autoencoder. The latent-space encoder used by latent diffusion models. RGBA video models like Wan-Alpha train a special VAE that encodes alpha alongside RGB. |
| **Internal motion** | Motion of components *within* a subject (a character's hair moving while their body stays still), as opposed to whole-image translation. The thing v1 cannot do. |
| **Loop seam** | The visible jump when a looping animation restarts. A clean loop has near-zero seam. |
| **Use case** | One of the 7 templates exposed at `/app/animations`. See [`schema.ts:92-127`](file:///c%3A/Users/emrec/codebase/active-projects/celstate/src/convex/schema.ts#L92-L127). |
| **v1 / v2** | v1 = current still-translate renderer. v2 = the native-RGBA-video renderer specified in §7. |
| **Kill-gate** | A go/no-go decision point in the roadmap. Failing a gate stops the project at that phase pending a §9.3 pivot decision. |

---

## 13. Open Questions

These are the unknowns the bible cannot pre-answer. Phase 1 should resolve as many as possible. Resolutions get logged in §14.

- Will Wan-Alpha v2.0 be hosted by fal.ai / Replicate by Phase 1 start, or do we self-host?
- Exact per-clip cost on whichever path we pick.
- Wan-Alpha I2V availability timeline (currently "on roadmap").
- Style consistency: does Wan-Alpha hold a character identity across multiple regens, or do we need a LoRA-per-brand workflow in Phase 4?
- Latency: is sub-5-minute realistic without batching, or do we need to commit to async UX in Phase 2?
- License: confirm Wan-Alpha v2.0 explicitly permits commercial use of generated content (the repo is open-source but generated content licensing is a separate axis).
- Does the existing `aspectRatio` field cover everything Wan-Alpha supports natively, or do we need to migrate?
- Does refinement (SAM2 on top of Wan-Alpha) actually improve QA scores, or does it introduce new artifacts?
- For the layered-procedural fallback: how much hand-tuning per use case is acceptable engineering effort?

---

## 14. Change Log

| Date       | Change                                                | Author |
| ---------- | ----------------------------------------------------- | ------ |
| 2026-05-10 | Initial bible. Supersedes v1 generation doc.          | Founder + AI |
|            |                                                       |        |

---

**End of bible. If you are about to write animation code, re-read §5, §7, and the current Phase in §8 before you start.**
